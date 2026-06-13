import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ServerTarget } from "../../src/model.js";
import { scanTargets } from "../../src/scan.js";

const MOCK = fileURLToPath(new URL("../fixtures/mock-server.mjs", import.meta.url));
const TIMEOUT = 20_000;

function target(env: Record<string, string> = {}): ServerTarget {
  return {
    id: "mock",
    transport: "stdio",
    source: "node mock-server.mjs",
    command: process.execPath,
    args: [MOCK],
    env,
  };
}

describe("--probe flow (live stdio MCP server)", () => {
  it("does not execute any tool when probing is off (read-only by default)", async () => {
    const warnings: string[] = [];
    const scan = await scanTargets(
      [target({ TOOLPRINT_TEST_PROBE: "1", TOOLPRINT_TEST_PROBE_POISON: "1" })],
      null,
      {
        timeoutMs: TIMEOUT,
        warn: (m) => warnings.push(m),
      },
    );
    // No probe option → no execution, no output findings, no warning.
    expect(scan.findings.some((f) => f.checkId === "tool-output")).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it("executes a read-only tool and flags poisoned output, warning first", async () => {
    const warnings: string[] = [];
    const scan = await scanTargets(
      [target({ TOOLPRINT_TEST_PROBE: "1", TOOLPRINT_TEST_PROBE_POISON: "1" })],
      null,
      {
        timeoutMs: TIMEOUT,
        probe: { includeReadOnly: true, tools: [] },
        warn: (m) => warnings.push(m),
      },
    );
    // The loud warning fired and named the tool.
    expect(warnings.join("\n")).toMatch(/EXECUTE.*get_status/);
    // The poisoned output produced a tool-output finding, escalated to critical.
    const output = scan.findings.filter((f) => f.checkId === "tool-output");
    expect(output.length).toBeGreaterThan(0);
    expect(output.some((f) => f.severity === "critical")).toBe(true);
    expect(output.every((f) => f.capability?.name === "get_status")).toBe(true);
  });

  it("finds nothing in clean output even when probing runs", async () => {
    const scan = await scanTargets([target({ TOOLPRINT_TEST_PROBE: "1" })], null, {
      timeoutMs: TIMEOUT,
      probe: { includeReadOnly: true, tools: [] },
    });
    expect(scan.findings.some((f) => f.checkId === "tool-output")).toBe(false);
  });
});
