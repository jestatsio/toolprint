import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding } from "../checks/types.js";
import { OperationalError } from "../errors.js";
import { type Baseline, diffAgainstBaseline, loadBaseline } from "./baseline.js";

function finding(title: string, serverId = "s"): Finding {
  return {
    checkId: "tool-poisoning",
    severity: "high",
    serverId,
    capability: { kind: "tool", name: "x" },
    title,
    detail: "…",
  };
}

function baselineOf(findings: Finding[]): Baseline {
  return { path: "base.json", findings };
}

describe("diffAgainstBaseline", () => {
  it("reports findings new and resolved since the baseline", () => {
    const base = baselineOf([finding("a"), finding("b")]);
    const current = [finding("b"), finding("c")];
    const diff = diffAgainstBaseline(current, base);
    expect(diff.newFindings.map((f) => f.title)).toEqual(["c"]);
    expect(diff.resolvedFindings.map((f) => f.title)).toEqual(["a"]);
  });

  it("is empty when nothing changed", () => {
    const base = baselineOf([finding("a")]);
    const diff = diffAgainstBaseline([finding("a")], base);
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.resolvedFindings).toHaveLength(0);
  });
});

describe("loadBaseline", () => {
  function write(name: string, content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "toolprint-baseline-"));
    const path = join(dir, name);
    writeFileSync(path, content, "utf8");
    return path;
  }

  it("loads findings from a toolprint --json report (incl. older reports without per-finding id)", () => {
    const report = {
      toolprintVersion: "0.2.0",
      servers: [
        {
          id: "s",
          findings: [
            {
              checkId: "tool-poisoning",
              severity: "high",
              serverId: "s",
              capability: { kind: "tool", name: "x" },
              title: "a",
            },
          ],
        },
      ],
    };
    const baseline = loadBaseline(write("base.json", JSON.stringify(report)));
    expect(baseline.findings).toHaveLength(1);
    // The freshly-scanned identical finding diffs as unchanged.
    expect(diffAgainstBaseline([finding("a")], baseline).newFindings).toHaveLength(0);
  });

  it("throws OperationalError on a missing file", () => {
    expect(() => loadBaseline("/no/such/baseline.json")).toThrow(OperationalError);
  });

  it("throws OperationalError on malformed JSON", () => {
    expect(() => loadBaseline(write("bad.json", "{not json"))).toThrow(OperationalError);
  });

  it("throws OperationalError when the JSON is not a toolprint report", () => {
    // Missing the identifying `toolprintVersion` — a wrong file, not an empty baseline.
    expect(() => loadBaseline(write("wrong.json", JSON.stringify({ hello: "world" })))).toThrow(
      OperationalError,
    );
    // Has toolprintVersion but a structurally-wrong findings entry still fails.
    expect(() =>
      loadBaseline(
        write(
          "bad2.json",
          JSON.stringify({
            toolprintVersion: "0.2.0",
            servers: [{ findings: [{ severity: "high" }] }],
          }),
        ),
      ),
    ).toThrow(OperationalError);
  });

  it("accepts a report with no findings as an empty baseline", () => {
    const baseline = loadBaseline(
      write("empty.json", JSON.stringify({ toolprintVersion: "0.2.0", servers: [] })),
    );
    expect(baseline.findings).toHaveLength(0);
  });
});
