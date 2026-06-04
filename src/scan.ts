import { runChecks } from "./checks/registry.js";
import type { Finding } from "./checks/types.js";
import { connectAndList } from "./connect/index.js";
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
  probeOutputs?: boolean;
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

  for (const target of targets) {
    try {
      const server = await connectAndList(target, { timeoutMs: options.timeoutMs });
      const diff = diffServer(server, lockfile?.servers[target.id]);
      const findings = runChecks({
        target,
        server,
        diff,
        probeOutputs: options.probeOutputs ?? false,
      });
      results.push({ target, server, diff, findings });
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
