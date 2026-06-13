import { runChecks } from "./checks/registry.js";
import type { Finding } from "./checks/types.js";
import { withConnectedServer } from "./connect/index.js";
import { probeTools, probeWarning, type ProbeRequest } from "./connect/probe.js";
import { diffServer, type ServerDiff } from "./lockfile/diff.js";
import type { Lockfile } from "./lockfile/schema.js";
import { getErrorMessage } from "./errors.js";
import type { ServerCapabilities, ServerTarget } from "./model.js";

export interface ServerScanResult {
  target: ServerTarget;
  /** Undefined when the connection failed. */
  server?: ServerCapabilities;
  diff?: ServerDiff;
  findings: Finding[];
  /** Operational failure message (connect/list), distinct from a finding. */
  error?: string;
}

export interface ScanResult {
  results: ServerScanResult[];
  findings: Finding[];
  /** At least one server failed to connect/list (drives exit code 1). */
  hadOperationalError: boolean;
}

export interface ScanOptions {
  timeoutMs?: number;
  /** When set, execute tools and inspect their output (`--probe`). Undefined
   * means the default read-only scan — no tool is ever called. */
  probe?: ProbeRequest;
  /** Sink for the loud "about to execute tools" warning (stderr in the CLI). */
  warn?: (message: string) => void;
}

/**
 * Connect to each target, diff it against the lockfile, and run the checks.
 * Servers are scanned sequentially so stdio child processes and console output
 * stay clean. One server failing is isolated — it's recorded and the rest run.
 */
export async function scanTargets(
  targets: ServerTarget[],
  lockfile: Lockfile | null,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const results: ServerScanResult[] = [];
  let hadOperationalError = false;
  const timeoutMs = options.timeoutMs;
  const probe = options.probe;

  for (const target of targets) {
    try {
      const result = await withConnectedServer(target, { timeoutMs }, async (client, server) => {
        const diff = diffServer(server, lockfile?.servers[target.id]);
        let probes;
        if (probe) {
          const warning = probeWarning(server, probe);
          if (warning && options.warn) options.warn(warning);
          probes = await probeTools(client, server, { ...probe, timeoutMs: timeoutMs ?? 30_000 });
        }
        const findings = runChecks({ target, server, diff, probes });
        return { target, server, diff, findings };
      });
      results.push(result);
    } catch (error) {
      hadOperationalError = true;
      results.push({ target, findings: [], error: getErrorMessage(error) });
    }
  }

  return {
    results,
    findings: results.flatMap((result) => result.findings),
    hadOperationalError,
  };
}
