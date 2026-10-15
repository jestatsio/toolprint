import type { Severity } from "./checks/types.js";
import { applyAuthHeaders, collectAuthHeaders } from "./connect/auth.js";
import { AGENT_CLIENT_IDS } from "./connect/clients.js";
import {
  discoverClientTargets,
  resolveSkillTargets,
  resolveTargets,
  type DiscoveryNote,
} from "./connect/target.js";
import { OperationalError } from "./errors.js";
import {
  displayLockPath,
  lockedContentEquals,
  mergeLockfile,
  readLockfile,
  resolveLockfilePath,
  writeLockfile,
} from "./lockfile/io.js";
import { isFailing } from "./outcome.js";
import { applySuppressionsToScan, readSuppressions, resolveIgnorePath } from "./suppressions.js";
import type { Suppression } from "./suppressions.js";
import { diffAgainstBaseline, loadBaseline, type BaselineDiff } from "./report/baseline.js";
import { findingId } from "./report/fingerprint.js";
import { scanTargets, type ScanResult } from "./scan.js";

/**
 * One scan request, shared by the CLI (`scan`/`pin`) and the MCP server
 * (`toolprint serve`). Keeping target resolution, suppression, pinning, and
 * the gate decision in one place means the two front ends can never disagree
 * about what a scan found or whether it failed — they only render differently.
 */
export interface ExecuteScanRequest {
  cwd: string;
  target?: string;
  config?: string;
  allClients?: boolean;
  /** Client ids for `--client`; validated against {@link AGENT_CLIENT_IDS}. */
  clients?: string[];
  useSkillroute?: boolean;
  /** `true` scans the default skill roots; a string scans that one directory. */
  skills?: boolean | string;
  /** True for `pin`: re-pin the lockfile to current reality after scanning. */
  update?: boolean;
  failOn: Severity;
  probe?: boolean;
  probeTools?: string[];
  baselinePath?: string;
  failOnNew?: boolean;
  ignoreFile?: string;
  lockfile?: string;
  timeoutMs: number;
  header?: string[];
  bearer?: string;
  /** Sink for the loud "about to execute tools" probe warning. */
  warn?: (message: string) => void;
}

export interface ExecuteScanResult {
  scan: ScanResult;
  /** Client configs found but not scanned (unsupported format etc.). */
  notes: DiscoveryNote[];
  expiredSuppressions: Suppression[];
  unusedSuppressions: Suppression[];
  suppressionsPath: string;
  baseline?: BaselineDiff;
  /** The gate decision (CLI exit code 2 when true). */
  failing: boolean;
  lockPath: string;
  lockDisplay: string;
  update: boolean;
  /** Whether a pin actually wrote the lockfile (false on a no-op re-pin). */
  wrote: boolean;
}

export async function executeScan(request: ExecuteScanRequest): Promise<ExecuteScanResult> {
  const cwd = request.cwd;
  const lockPath = resolveLockfilePath(cwd, request.lockfile);
  const lockfile = readLockfile(lockPath);
  const authHeaders = collectAuthHeaders({
    header: request.header ?? [],
    bearer: request.bearer,
  });
  const clientIds = request.clients ?? [];
  const acrossClients = Boolean(request.allClients) || clientIds.length > 0;
  const skillDirs =
    request.skills === undefined ? [] : typeof request.skills === "string" ? [request.skills] : [];
  const scanSkills = request.skills !== undefined;

  if (scanSkills && (acrossClients || request.target || request.config)) {
    throw new OperationalError(
      "--skills scans skill bundles on disk; run it on its own, not with a server target.",
    );
  }
  if (acrossClients && (request.target || request.config)) {
    throw new OperationalError(
      "--all-clients/--client discovers configs itself; drop the explicit target or --config.",
    );
  }
  for (const id of clientIds) {
    if (!AGENT_CLIENT_IDS.includes(id)) {
      throw new OperationalError(
        `Unknown --client "${id}". Known clients: ${AGENT_CLIENT_IDS.join(", ")}.`,
      );
    }
  }

  let notes: DiscoveryNote[] = [];
  let discoveredTargets;
  if (scanSkills) {
    discoveredTargets = resolveSkillTargets(skillDirs, cwd);
  } else if (acrossClients) {
    const discovery = discoverClientTargets({
      cwd,
      ...(clientIds.length > 0 ? { only: clientIds } : {}),
      useSkillroute: Boolean(request.useSkillroute),
    });
    notes = discovery.notes;
    if (discovery.targets.length === 0) {
      throw new OperationalError(
        `No MCP servers found across ${discovery.scanned} agent client config(s). ` +
          "Pass a target explicitly, or check `--client` spelling.",
      );
    }
    discoveredTargets = discovery.targets;
  } else {
    discoveredTargets = resolveTargets(request.target, { config: request.config }, cwd);
  }
  const targets = applyAuthHeaders(discoveredTargets, authHeaders);

  const probeTools = request.probeTools ?? [];
  const probe =
    request.probe || probeTools.length > 0
      ? { includeReadOnly: Boolean(request.probe), tools: probeTools }
      : undefined;

  const rawScan = await scanTargets(targets, lockfile, {
    timeoutMs: request.timeoutMs,
    probe,
    warn: request.warn,
  });

  // Suppressions are applied before anything reads the findings, so the report,
  // the baseline diff, and the exit code all agree on what is enforced.
  const suppressions = readSuppressions(resolveIgnorePath(cwd, request.ignoreFile));
  const applied = applySuppressionsToScan(rawScan, suppressions);
  const scan = applied.scan;

  if (request.failOnNew && !request.baselinePath) {
    throw new OperationalError("--fail-on-new requires --baseline <path> to compare against.");
  }
  const baseline: BaselineDiff | undefined = request.baselinePath
    ? diffAgainstBaseline(scan.findings, loadBaseline(request.baselinePath))
    : undefined;

  const update = Boolean(request.update);
  let wrote = false;
  if (update) {
    const scannedServers = scan.results.flatMap((result) => (result.server ? [result.server] : []));
    const next = mergeLockfile(lockfile, scannedServers, new Date().toISOString());
    // Skip a no-op write so re-pinning never churns the committed lockfile's timestamp.
    if (lockfile === null || !lockedContentEquals(lockfile, next)) {
      writeLockfile(lockPath, next);
      wrote = true;
    }
  }

  const newFindingIds =
    request.failOnNew && baseline
      ? new Set(baseline.newFindings.map((finding) => findingId(finding)))
      : undefined;
  const failing = isFailing(scan.findings, {
    failOn: request.failOn,
    update,
    ...(newFindingIds ? { newFindingIds } : {}),
  });

  return {
    scan,
    notes,
    expiredSuppressions: applied.expired,
    unusedSuppressions: applied.unused,
    suppressionsPath: suppressions.path,
    baseline,
    failing,
    lockPath,
    lockDisplay: displayLockPath(cwd, lockPath),
    update,
    wrote,
  };
}
