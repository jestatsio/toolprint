#!/usr/bin/env node
import { Command } from "commander";
import { SEVERITIES, type Severity } from "./checks/types.js";
import { applyAuthHeaders, collectAuthHeaders } from "./connect/auth.js";
import { resolveTargets } from "./connect/target.js";
import { getErrorMessage, OperationalError } from "./errors.js";
import {
  displayLockPath,
  lockedContentEquals,
  mergeLockfile,
  readLockfile,
  resolveLockfilePath,
  writeLockfile,
} from "./lockfile/io.js";
import { exitCodeFor, isFailing } from "./outcome.js";
import { renderHuman } from "./report/human.js";
import { buildJsonReport, renderJson } from "./report/json.js";
import { buildSarifReport, renderSarif, toArtifactUri } from "./report/sarif.js";
import { scanTargets } from "./scan.js";
import { TOOLPRINT_VERSION } from "./version.js";

interface ScanCliOptions {
  config?: string;
  update?: boolean;
  failOn: string;
  json?: boolean;
  sarif?: boolean;
  probe?: boolean;
  lockfile?: string;
  timeout: string;
  header: string[]; // repeated --header; defaults to []
  bearer?: string;
  telemetry: boolean; // commander maps --no-telemetry to telemetry:false
  color: boolean; // commander maps --no-color to color:false
}

/** Commander collector for a repeatable string option. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseSeverity(value: string): Severity {
  if ((SEVERITIES as string[]).includes(value)) return value as Severity;
  throw new OperationalError(
    `Invalid --fail-on severity: "${value}". Use one of: ${SEVERITIES.join(", ")}.`,
  );
}

async function runScan(target: string | undefined, options: ScanCliOptions): Promise<void> {
  const cwd = process.cwd();
  const failOn = parseSeverity(options.failOn);
  const timeoutMs = Number(options.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new OperationalError(
      `Invalid --timeout: "${options.timeout}" (expected a positive number of ms).`,
    );
  }

  const lockPath = resolveLockfilePath(cwd, options.lockfile);
  const lockfile = readLockfile(lockPath);
  const authHeaders = collectAuthHeaders({ header: options.header, bearer: options.bearer });
  const targets = applyAuthHeaders(
    resolveTargets(target, { config: options.config }, cwd),
    authHeaders,
  );

  const scan = await scanTargets(targets, lockfile, {
    timeoutMs,
    probeOutputs: Boolean(options.probe),
  });

  const update = Boolean(options.update);
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

  const failing = isFailing(scan.findings, { failOn, update });
  const lockDisplay = displayLockPath(cwd, lockPath);

  if (options.sarif) {
    // Findings have no source line; anchor them to the scanned config (or the
    // lockfile) so GitHub code scanning can display them.
    const anchorUri = toArtifactUri(cwd, options.config ?? lockPath);
    process.stdout.write(renderSarif(buildSarifReport(scan, { anchorUri })));
  } else if (options.json) {
    const updateSummary = update ? { lockfile: lockDisplay, wrote, failed: failing } : undefined;
    process.stdout.write(renderJson(buildJsonReport(scan, updateSummary)));
  } else {
    const color =
      options.color !== false &&
      process.stdout.isTTY === true &&
      process.env.NO_COLOR === undefined;
    process.stdout.write(
      renderHuman(scan, { color, lockDisplay, updated: update, wrote, failOn, failing }),
    );
  }

  process.exitCode = exitCodeFor(failing, scan.hadOperationalError);
}

function withScanOptions(command: Command): Command {
  return command
    .option("--config <path>", "MCP client config file to scan (Claude Desktop / VS Code / Cursor)")
    .option(
      "--fail-on <severity>",
      "minimum severity that fails the scan (info|low|medium|high|critical)",
      "high",
    )
    .option("--json", "output machine-readable JSON")
    .option("--sarif", "output SARIF 2.1.0 for GitHub code scanning")
    .option("--probe", "reserved: inspect tool outputs (toolprint never executes tools by default)")
    .option("--lockfile <path>", "path to the lockfile (default: nearest toolprint.lock)")
    .option("--timeout <ms>", "per-server timeout in milliseconds", "30000")
    .option(
      "--header <header>",
      'add an HTTP header to http(s)/sse targets, e.g. --header "Authorization: Bearer $TOKEN" (repeatable)',
      collect,
      [],
    )
    .option("--bearer <token>", 'shorthand for --header "Authorization: Bearer <token>"')
    .option("--no-telemetry", "disable anonymous usage telemetry")
    .option("--no-color", "disable colored output");
}

const program = new Command();
program
  .name("toolprint")
  .description(
    "package-lock.json for MCP trust — scan MCP servers for tool poisoning, secret leaks, and silent rug-pulls.",
  )
  .version(TOOLPRINT_VERSION)
  .showHelpAfterError();

withScanOptions(
  program.command("scan [target]").description("Scan server(s) and compare against the lockfile"),
)
  .option("--update", "pin current definitions into the lockfile, then commit it")
  .action((target: string | undefined, options: ScanCliOptions) => runScan(target, options));

withScanOptions(
  program
    .command("pin [target]")
    .description("Alias for `scan --update`: pin current definitions into the lockfile"),
).action((target: string | undefined, options: ScanCliOptions) =>
  runScan(target, { ...options, update: true }),
);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    process.stderr.write(`toolprint: ${getErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
