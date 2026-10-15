import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServerTarget } from "./model.js";
import { scanTargets } from "./scan.js";
import { createToolprintServer } from "./server.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_TS = fileURLToPath(new URL("./cli.ts", import.meta.url));
const TIMEOUT = 30_000;

const CLEAN_CONFIG = join(REPO_ROOT, "test/fixtures/mcp-clean.json");
const POISON_CONFIG = join(REPO_ROOT, "test/fixtures/mcp-poison.json");

interface StructuredScan {
  failing: boolean;
  exitCode: number;
  summary: { servers: number; findings: number; bySeverity: Record<string, number> };
  update?: { lockfile: string; wrote: boolean; failed: boolean };
}

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const server = createToolprintServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "toolprint-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function callScan(
  client: Client,
  name: "scan" | "pin",
  args: Record<string, unknown>,
): Promise<StructuredScan> {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: TIMEOUT,
  });
  expect(result.isError).not.toBe(true);
  const text = (result.content as { type: string; text?: string }[])[0]?.text ?? "";
  expect(text).toContain("toolprint");
  return result.structuredContent as StructuredScan;
}

describe("toolprint MCP server (in-memory)", () => {
  let dir: string;
  let lockfile: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "toolprint-server-"));
    lockfile = join(dir, "toolprint.lock");
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("exposes scan and pin with honest annotations", async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(["pin", "scan"]);
      const scan = tools.find((tool) => tool.name === "scan");
      const pin = tools.find((tool) => tool.name === "pin");
      expect(scan?.annotations?.readOnlyHint).toBe(true);
      expect(pin?.annotations?.readOnlyHint).toBe(false);
      expect(pin?.annotations?.idempotentHint).toBe(true);
    });
  });

  it("pin writes a lockfile and a follow-up scan of the clean fixture passes", async () => {
    await withClient(async (client) => {
      const pinned = await callScan(client, "pin", {
        config: CLEAN_CONFIG,
        workingDirectory: REPO_ROOT,
        lockfile,
        timeoutMs: TIMEOUT,
      });
      expect(pinned.update?.wrote).toBe(true);
      expect(pinned.failing).toBe(false);
      expect(existsSync(lockfile)).toBe(true);

      const scanned = await callScan(client, "scan", {
        config: CLEAN_CONFIG,
        workingDirectory: REPO_ROOT,
        lockfile,
        timeoutMs: TIMEOUT,
      });
      expect(scanned.failing).toBe(false);
      expect(scanned.exitCode).toBe(0);
      expect(scanned.summary.servers).toBe(1);
      expect(scanned.update).toBeUndefined();
    });
  });

  it("a poisoned fixture fails the scan through the MCP tool", async () => {
    await withClient(async (client) => {
      const scanned = await callScan(client, "scan", {
        config: POISON_CONFIG,
        workingDirectory: REPO_ROOT,
        lockfile: join(dir, "never-written.lock"),
        timeoutMs: TIMEOUT,
      });
      expect(scanned.failing).toBe(true);
      expect(scanned.exitCode).toBe(2);
      expect(
        (scanned.summary.bySeverity.high ?? 0) + (scanned.summary.bySeverity.critical ?? 0),
      ).toBeGreaterThan(0);
      // `scan` is read-only: no lockfile appears as a side effect.
      expect(existsSync(join(dir, "never-written.lock"))).toBe(false);
    });
  });

  it("rejects a bad workingDirectory as a tool error", async () => {
    await withClient(async (client) => {
      const result = await client.callTool(
        { name: "scan", arguments: { workingDirectory: join(dir, "does-not-exist") } },
        undefined,
        { timeout: TIMEOUT },
      );
      expect(result.isError).toBe(true);
    });
  });

  it("toolprint passes its own scan (dogfood)", async () => {
    const target: ServerTarget = {
      id: "toolprint-self",
      transport: "stdio",
      source: "node --import tsx src/cli.ts serve",
      command: process.execPath,
      args: ["--import", "tsx", CLI_TS, "serve"],
      env: {},
    };
    const scan = await scanTargets([target], null, { timeoutMs: TIMEOUT });
    expect(scan.hadOperationalError).toBe(false);
    const server = scan.results[0]?.server;
    expect(server?.tools.map((tool) => tool.name).sort()).toEqual(["pin", "scan"]);
    const serious = scan.findings.filter(
      (finding) => finding.severity === "high" || finding.severity === "critical",
    );
    expect(serious).toEqual([]);
  });
});
