import { describe, expect, it } from "vitest";
import type { Finding } from "../checks/types.js";
import type { ScanResult } from "../scan.js";
import { findingId } from "./fingerprint.js";
import { buildJsonReport } from "./json.js";

const FINDING: Finding = {
  checkId: "tool-poisoning",
  severity: "high",
  serverId: "s",
  capability: { kind: "tool", name: "x" },
  title: 'Instruction-override phrase in tool "x"',
  detail: "…",
};

function scanWith(findings: Finding[]): ScanResult {
  return {
    results: [
      {
        target: { id: "s", transport: "stdio", source: "x", command: "x" },
        server: {
          id: "s",
          transport: "stdio",
          source: "x",
          tools: [],
          prompts: [],
          resources: [],
          resourceTemplates: [],
        },
        diff: undefined,
        findings,
      },
    ],
    findings,
    hadOperationalError: false,
  };
}

describe("buildJsonReport", () => {
  it("stamps the injected generatedAt rather than reading the clock", () => {
    const report = buildJsonReport(scanWith([]), { generatedAt: "2026-06-13T00:00:00.000Z" });
    expect(report.generatedAt).toBe("2026-06-13T00:00:00.000Z");
    expect(report.schemaVersion).toBe(1);
  });

  it("attaches a stable id to every finding", () => {
    const report = buildJsonReport(scanWith([FINDING]), { generatedAt: "t" });
    expect(report.servers[0]?.findings[0]?.id).toBe(findingId(FINDING));
  });
});
