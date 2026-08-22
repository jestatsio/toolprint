import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding } from "./checks/types.js";
import { OperationalError } from "./errors.js";
import { isFailing } from "./outcome.js";
import { findingId } from "./report/fingerprint.js";
import { applySuppressions, readSuppressions, type Suppressions } from "./suppressions.js";

const finding: Finding = {
  checkId: "tool-poisoning",
  severity: "high",
  serverId: "mock",
  capability: { kind: "tool", name: "helper" },
  title: 'Instruction-override phrase in tool "helper"',
  detail: "d",
};

const id = findingId(finding);

function suppressions(entries: Suppressions["entries"]): Suppressions {
  return { path: "toolprint.ignore.json", entries };
}

describe("applySuppressions", () => {
  it("marks a matched finding without dropping it from the report", () => {
    const result = applySuppressions([finding], suppressions([{ id, reason: "reviewed" }]));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.suppressed).toBe(true);
  });

  it("leaves the original finding object untouched", () => {
    applySuppressions([finding], suppressions([{ id, reason: "reviewed" }]));
    expect(finding.suppressed).toBeUndefined();
  });

  it("stops applying after `expires` and reports the entry as expired", () => {
    const result = applySuppressions(
      [finding],
      suppressions([{ id, reason: "temporary", expires: "2026-01-01" }]),
      new Date("2026-08-22T00:00:00Z"),
    );
    expect(result.findings[0]?.suppressed).toBeUndefined();
    expect(result.expired).toHaveLength(1);
  });

  it("still applies on the expiry date itself", () => {
    const result = applySuppressions(
      [finding],
      suppressions([{ id, reason: "temporary", expires: "2026-08-22" }]),
      new Date("2026-08-22T12:00:00Z"),
    );
    expect(result.findings[0]?.suppressed).toBe(true);
  });

  it("reports an entry that matched nothing, so the file can be pruned", () => {
    const result = applySuppressions(
      [finding],
      suppressions([{ id: "deadbeef", reason: "stale" }]),
    );
    expect(result.unused.map((entry) => entry.id)).toEqual(["deadbeef"]);
  });
});

describe("isFailing with suppressions", () => {
  it("a suppressed high finding does not fail the run", () => {
    const [suppressed] = applySuppressions(
      [finding],
      suppressions([{ id, reason: "ok" }]),
    ).findings;
    expect(isFailing([suppressed as Finding], { failOn: "high", update: false })).toBe(false);
  });

  it("the same finding unsuppressed still fails", () => {
    expect(isFailing([finding], { failOn: "high", update: false })).toBe(true);
  });
});

describe("isFailing with --fail-on-new", () => {
  it("does not fail on a pre-existing finding", () => {
    expect(isFailing([finding], { failOn: "high", update: false, newFindingIds: new Set() })).toBe(
      false,
    );
  });

  it("fails on a finding that is new since the baseline", () => {
    expect(
      isFailing([finding], { failOn: "high", update: false, newFindingIds: new Set([id]) }),
    ).toBe(true);
  });
});

describe("readSuppressions", () => {
  it("treats an absent file as no suppressions", () => {
    expect(readSuppressions(join(tmpdir(), "toolprint-no-such-ignore.json")).entries).toEqual([]);
  });

  it("rejects a malformed file rather than silently enforcing everything", () => {
    const dir = mkdtempSync(join(tmpdir(), "toolprint-ig-"));
    const path = join(dir, "toolprint.ignore.json");
    // `reason` is required: an unexplained suppression is a liability.
    writeFileSync(path, JSON.stringify({ ignore: [{ id: "abc" }] }));
    expect(() => readSuppressions(path)).toThrow(OperationalError);
  });

  it("rejects invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "toolprint-ig-"));
    const path = join(dir, "toolprint.ignore.json");
    writeFileSync(path, "{not json");
    expect(() => readSuppressions(path)).toThrow(OperationalError);
  });
});
