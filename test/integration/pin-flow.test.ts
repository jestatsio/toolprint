import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gatingFindings, isFailing } from "../../src/outcome.js";
import {
  lockedContentEquals,
  mergeLockfile,
  readLockfile,
  writeLockfile,
} from "../../src/lockfile/io.js";
import type { Lockfile } from "../../src/lockfile/schema.js";
import type { ServerCapabilities, ServerTarget } from "../../src/model.js";
import { scanTargets } from "../../src/scan.js";

const MOCK = fileURLToPath(new URL("../fixtures/mock-server.mjs", import.meta.url));
const TIMEOUT = 20_000;

function target(env: Record<string, string> = {}, id = "mock"): ServerTarget {
  return {
    id,
    transport: "stdio",
    source: "node mock-server.mjs",
    command: process.execPath,
    args: [MOCK],
    env,
  };
}

function scannedServers(results: { server?: ServerCapabilities }[]): ServerCapabilities[] {
  return results.flatMap((r) => (r.server ? [r.server] : []));
}

/** Connect to the clean server and produce an in-memory pinned lock — a fresh
 *  baseline so each test is independent of the others' ordering. */
async function baseline(): Promise<Lockfile> {
  const scan = await scanTargets([target()], null, { timeoutMs: TIMEOUT });
  expect(scan.hadOperationalError).toBe(false);
  return mergeLockfile(null, scannedServers(scan.results), "baseline");
}

describe("pin/update flow (live stdio MCP server)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "toolprint-pin-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("a first pin records the live server's capabilities", async () => {
    const scan = await scanTargets([target()], null, { timeoutMs: TIMEOUT });
    const lock = mergeLockfile(null, scannedServers(scan.results), "now");
    expect(lock.servers.mock?.tools.read_file?.description).toContain("Read the complete contents");
    expect(lock.servers.mock?.tools.list_dir).toBeDefined();
    // First pin has only an "unpinned" info finding — nothing that gates a pin.
    expect(isFailing(scan.findings, { failOn: "high", update: true })).toBe(false);
  });

  it("a clean re-scan against the lock reports no drift", async () => {
    const lock = await baseline();
    const scan = await scanTargets([target()], lock, { timeoutMs: TIMEOUT });
    expect(scan.findings.filter((f) => f.checkId === "rug-pull")).toHaveLength(0);
    expect(isFailing(scan.findings, { failOn: "high", update: false })).toBe(false);
  });

  it("a benign description change fails a plain scan but not a pin", async () => {
    const lock = await baseline();
    const scan = await scanTargets([target({ TOOLPRINT_TEST_BENIGN: "1" })], lock, {
      timeoutMs: TIMEOUT,
    });
    const drift = scan.findings.find(
      (f) => f.checkId === "rug-pull" && f.capability?.name === "list_dir",
    );
    expect(drift?.severity).toBe("high");
    // Drift gates a verify, but not an explicit re-pin.
    expect(isFailing(scan.findings, { failOn: "high", update: false })).toBe(true);
    expect(isFailing(scan.findings, { failOn: "high", update: true })).toBe(false);
    // Re-pinning actually changes the lock content.
    const next = mergeLockfile(lock, scannedServers(scan.results), "now");
    expect(lockedContentEquals(lock, next)).toBe(false);
    // ...and a re-scan against the updated lock is clean.
    const after = await scanTargets([target({ TOOLPRINT_TEST_BENIGN: "1" })], next, {
      timeoutMs: TIMEOUT,
    });
    expect(after.findings.filter((f) => f.checkId === "rug-pull")).toHaveLength(0);
  });

  it("a malicious rug-pull is also caught as poisoning, which gates even a pin", async () => {
    const lock = await baseline();
    const scan = await scanTargets([target({ TOOLPRINT_TEST_RUGPULL: "1" })], lock, {
      timeoutMs: TIMEOUT,
    });
    const drift = scan.findings.find(
      (f) => f.checkId === "rug-pull" && f.capability?.name === "read_file",
    );
    expect(drift?.severity).toBe("high");
    expect(drift?.diff?.after).toContain("attacker@evil.com");
    const poison = scan.findings.find((f) => f.checkId === "tool-poisoning");
    expect(poison).toBeDefined();
    // The pin would still write the lock, but the poison makes it exit non-zero.
    expect(isFailing(scan.findings, { failOn: "high", update: true })).toBe(true);
  });

  it("an added poisoned tool gates a pin without any drift", async () => {
    const lock = await baseline();
    const scan = await scanTargets([target({ TOOLPRINT_TEST_POISON: "1" })], lock, {
      timeoutMs: TIMEOUT,
    });
    const poison = scan.findings.find(
      (f) => f.checkId === "tool-poisoning" && f.capability?.name === "helper",
    );
    expect(poison?.severity).toBe("high");
    expect(isFailing(scan.findings, { failOn: "high", update: true })).toBe(true);
  });

  it("writes a readable lockfile and is idempotent on an unchanged re-pin", async () => {
    const lockPath = join(dir, "toolprint.lock");
    const first = await scanTargets([target()], null, { timeoutMs: TIMEOUT });
    const lock = mergeLockfile(null, scannedServers(first.results), "now");
    writeLockfile(lockPath, lock);
    expect(existsSync(lockPath)).toBe(true);

    const reread = readLockfile(lockPath);
    expect(reread?.servers.mock?.tools.read_file).toBeDefined();

    // Re-scanning the same server and re-merging yields content-equal output,
    // so the CLI would skip the write (no timestamp churn).
    const second = await scanTargets([target()], reread, { timeoutMs: TIMEOUT });
    const next = mergeLockfile(reread, scannedServers(second.results), "later");
    expect(lockedContentEquals(reread as Lockfile, next)).toBe(true);
  });

  it("in a mixed run, one server's poison gates the pin while another's drift is accepted", async () => {
    const base = await scanTargets([target({}, "srvA"), target({}, "srvB")], null, {
      timeoutMs: TIMEOUT,
    });
    const lock = mergeLockfile(null, scannedServers(base.results), "baseline");

    const scan = await scanTargets(
      [
        target({ TOOLPRINT_TEST_POISON: "1" }, "srvA"),
        target({ TOOLPRINT_TEST_BENIGN: "1" }, "srvB"),
      ],
      lock,
      { timeoutMs: TIMEOUT },
    );
    const poison = scan.findings.find(
      (f) => f.checkId === "tool-poisoning" && f.serverId === "srvA",
    );
    const drift = scan.findings.find((f) => f.checkId === "rug-pull" && f.serverId === "srvB");
    expect(poison).toBeDefined();
    expect(drift?.severity).toBe("high");

    // The pin still writes (both servers change), but srvA's poison gates it...
    expect(isFailing(scan.findings, { failOn: "high", update: true })).toBe(true);
    const gated = gatingFindings(scan.findings, true);
    expect(gated.some((f) => f.checkId === "tool-poisoning")).toBe(true);
    expect(gated.some((f) => f.checkId === "rug-pull")).toBe(false);
    const next = mergeLockfile(lock, scannedServers(scan.results), "now");
    expect(lockedContentEquals(lock, next)).toBe(false);
  });

  it("when every server fails to connect, a pin writes nothing", async () => {
    const lock = await baseline();
    const bad: ServerTarget = {
      id: "mock",
      transport: "stdio",
      source: "missing",
      command: "toolprint-no-such-command-xyz",
      args: [],
    };
    const scan = await scanTargets([bad], lock, { timeoutMs: TIMEOUT });
    expect(scan.hadOperationalError).toBe(true);
    // Nothing was scanned, so the merged lock is content-equal — the CLI skips the write.
    const next = mergeLockfile(lock, scannedServers(scan.results), "later");
    expect(lockedContentEquals(lock, next)).toBe(true);
  });

  it("scans listed resources for poisoning, not only tools and prompts", async () => {
    const scan = await scanTargets([target({ TOOLPRINT_TEST_RESOURCE: "1" })], null, {
      timeoutMs: TIMEOUT,
    });
    // The resource must round-trip connect -> list -> normalize -> check.
    const poison = scan.findings.find(
      (f) => f.checkId === "tool-poisoning" && f.capability?.kind === "resource",
    );
    expect(poison?.severity).toBe("high");
    expect(poison?.capability?.name).toBe("file:///notes");
  });

  it("degrades to an operational error on a pathologically deep response (no crash)", async () => {
    const scan = await scanTargets([target({ TOOLPRINT_TEST_DEEP: "1" })], null, {
      timeoutMs: TIMEOUT,
    });
    // The deep schema is refused while hashing and surfaces as an operational
    // error for that server — the process must not stack-overflow.
    expect(scan.hadOperationalError).toBe(true);
    expect(scan.results[0]?.error).toMatch(/nested deeper/);
  });
});
