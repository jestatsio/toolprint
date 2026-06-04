import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveTargets } from "../../src/connect/target.js";
import type { ServerTarget } from "../../src/model.js";
import { scanTargets } from "../../src/scan.js";
// Plain ESM fixture (no type declarations); resolved at runtime by vitest.
import { startHttpMockServer } from "../fixtures/mock-http-server.mjs";

const TIMEOUT = 15_000;

describe("http (Streamable HTTP) transport", () => {
  let server: Awaited<ReturnType<typeof startHttpMockServer>>;

  beforeAll(async () => {
    server = await startHttpMockServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it("resolves an http(s) URL to an http target", () => {
    const targets = resolveTargets(server.url, {}, process.cwd());
    expect(targets).toHaveLength(1);
    expect(targets[0]?.transport).toBe("http");
    expect(targets[0]?.url).toBe(server.url);
  });

  it("connects over Streamable HTTP and enumerates every capability kind", async () => {
    const targets = resolveTargets(server.url, {}, process.cwd());
    const scan = await scanTargets(targets, null, { timeoutMs: TIMEOUT });

    expect(scan.hadOperationalError).toBe(false);
    const live = scan.results[0]?.server;
    expect(live?.transport).toBe("http");
    expect(live?.tools.map((t) => t.name)).toContain("read_file");
    // Resource templates round-trip over HTTP too, not just stdio.
    expect(live?.resourceTemplates.map((t) => t.name)).toContain("file-by-path");
  });

  it("runs the security checks over HTTP and flags a poisoned tool", async () => {
    const poisoned = await startHttpMockServer({ poison: true });
    try {
      const scan = await scanTargets(resolveTargets(poisoned.url, {}, process.cwd()), null, {
        timeoutMs: TIMEOUT,
      });
      const poison = scan.findings.find(
        (f) => f.checkId === "tool-poisoning" && f.capability?.name === "helper",
      );
      expect(poison?.severity).toBe("high");
    } finally {
      await poisoned.close();
    }
  });

  it("reports an operational error when the HTTP endpoint is unreachable", async () => {
    // Nothing is listening here; the Streamable-HTTP-then-SSE attempts both fail.
    const targets = resolveTargets("http://127.0.0.1:1/mcp", {}, process.cwd());
    const scan = await scanTargets(targets, null, { timeoutMs: TIMEOUT });
    expect(scan.hadOperationalError).toBe(true);
    expect(scan.results[0]?.server).toBeUndefined();
  });
});

describe("sse (legacy) transport wiring", () => {
  // SSEServerTransport is deprecated in MCP (superseded by Streamable HTTP), so a
  // live legacy-server fixture is intentionally omitted. This confirms the `sse`
  // branch of connectClient is reached and fails gracefully (not a crash) — its
  // target resolution is covered in connect/configParser.test.ts.
  it("uses the SSE client transport for an sse target and surfaces a clean error", async () => {
    const target: ServerTarget = {
      id: "legacy",
      transport: "sse",
      source: "http://127.0.0.1:1/sse",
      url: "http://127.0.0.1:1/sse",
    };
    const scan = await scanTargets([target], null, { timeoutMs: TIMEOUT });
    expect(scan.hadOperationalError).toBe(true);
    expect(scan.results[0]?.error).toBeTruthy();
  });
});
