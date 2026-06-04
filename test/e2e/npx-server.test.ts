import { describe, expect, it } from "vitest";
import { meetsThreshold } from "../../src/checks/types.js";
import { resolveTargets } from "../../src/connect/target.js";
import { mergeLockfile } from "../../src/lockfile/io.js";
import { scanTargets } from "../../src/scan.js";

/**
 * End-to-end smoke test against a REAL published MCP server downloaded via npx.
 *
 * Gated behind TOOLPRINT_E2E because it needs network access and is slow
 * (npx fetches the package on first run), so it never blocks the fast,
 * offline unit/integration suite. Run it with `npm run test:e2e`.
 *
 * The reference server `@modelcontextprotocol/server-everything` is ideal: it
 * exposes tools, prompts, resources, AND resource templates, so it exercises
 * the entire capability surface — including the npx:<package> target form and
 * stdio download/spawn path that the mock server can't cover.
 */

const E2E_ENABLED = process.env.TOOLPRINT_E2E === "1";
const SPEC = "npx:@modelcontextprotocol/server-everything";
const TIMEOUT_MS = 120_000;

describe.skipIf(!E2E_ENABLED)("e2e: scanning a real npx MCP server", () => {
  it(
    "connects, enumerates every capability kind, and stays clean (no false positives)",
    async () => {
      const targets = resolveTargets(SPEC, {}, process.cwd());
      expect(targets).toHaveLength(1);
      expect(targets[0]?.command).toBe("npx");

      const scan = await scanTargets(targets, null, { timeoutMs: TIMEOUT_MS });
      expect(scan.hadOperationalError).toBe(false);

      const server = scan.results[0]?.server;
      expect(server).toBeDefined();
      // The reference server has all four kinds; resource templates in particular
      // validate enumeration against a genuine server, not just the mock.
      expect(server!.tools.length).toBeGreaterThan(0);
      expect(server!.prompts.length).toBeGreaterThan(0);
      expect(server!.resources.length).toBeGreaterThan(0);
      expect(server!.resourceTemplates.length).toBeGreaterThan(0);

      // Precision guard against real data: a benign reference server must not
      // trip a high-severity poisoning/secret finding. Drift (rug-pull) is
      // expected on a first, unpinned scan and is excluded here.
      const falsePositives = scan.findings.filter(
        (f) => f.checkId !== "rug-pull" && meetsThreshold(f.severity, "high"),
      );
      expect(falsePositives).toEqual([]);
    },
    TIMEOUT_MS + 60_000,
  );

  it(
    "pins the server and reports no drift on a re-scan",
    async () => {
      const targets = resolveTargets(SPEC, {}, process.cwd());
      const first = await scanTargets(targets, null, { timeoutMs: TIMEOUT_MS });
      const scanned = first.results.flatMap((r) => (r.server ? [r.server] : []));
      expect(scanned.length).toBe(1);

      const lock = mergeLockfile(null, scanned, "e2e");
      expect(Object.keys(lock.servers)).toHaveLength(1);

      const second = await scanTargets(targets, lock, { timeoutMs: TIMEOUT_MS });
      expect(second.findings.filter((f) => f.checkId === "rug-pull")).toHaveLength(0);
    },
    2 * TIMEOUT_MS + 60_000,
  );
});
