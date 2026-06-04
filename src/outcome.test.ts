import { describe, expect, it } from "vitest";
import type { Finding, Severity } from "./checks/types.js";
import { exitCodeFor, gatingFindings, isFailing } from "./outcome.js";

function finding(checkId: string, severity: Severity): Finding {
  return { checkId, severity, serverId: "srv", title: "t", detail: "d" };
}

describe("gatingFindings", () => {
  it("counts every finding for a plain scan", () => {
    const findings = [finding("rug-pull", "high"), finding("secret-leak", "high")];
    expect(gatingFindings(findings, false)).toHaveLength(2);
  });

  it("drops rug-pull drift when updating, since a pin accepts it", () => {
    const findings = [
      finding("rug-pull", "high"),
      finding("tool-poisoning", "high"),
      finding("secret-leak", "medium"),
    ];
    expect(gatingFindings(findings, true).map((f) => f.checkId)).toEqual([
      "tool-poisoning",
      "secret-leak",
    ]);
  });
});

describe("isFailing", () => {
  it("fails a scan on a high rug-pull", () => {
    expect(isFailing([finding("rug-pull", "high")], { failOn: "high", update: false })).toBe(true);
  });

  it("does NOT fail a pin on rug-pull drift alone", () => {
    expect(isFailing([finding("rug-pull", "high")], { failOn: "high", update: true })).toBe(false);
  });

  it("DOES fail a pin on poisoning or a leaked secret at/above threshold", () => {
    expect(isFailing([finding("tool-poisoning", "high")], { failOn: "high", update: true })).toBe(
      true,
    );
    expect(isFailing([finding("secret-leak", "critical")], { failOn: "high", update: true })).toBe(
      true,
    );
  });

  it("respects the threshold on a pin", () => {
    expect(isFailing([finding("secret-leak", "low")], { failOn: "high", update: true })).toBe(
      false,
    );
  });
});

describe("exitCodeFor", () => {
  it("returns 2 when failing (findings at/above threshold or drift)", () => {
    expect(exitCodeFor(true, false)).toBe(2);
    expect(exitCodeFor(true, true)).toBe(2);
  });

  it("returns 1 on an operational error when not otherwise failing", () => {
    expect(exitCodeFor(false, true)).toBe(1);
  });

  it("returns 0 when clean", () => {
    expect(exitCodeFor(false, false)).toBe(0);
  });
});
