#!/usr/bin/env node
import { Command } from "commander";
import { meetsThreshold, SEVERITIES, type Severity } from "./checks/types.js";
import { resolveTargets } from "./connect/target.js";
import { getErrorMessage, OperationalError } from "./errors.js";
import { mergeLockfile, readLockfile, resolveLockfilePath, writeLockfile } from "./lockfile/io.js";
import { renderHuman } from "./report/human.js";
import { buildJsonReport, renderJson } from "./report/json.js";
import { scanTargets } from "./scan.js";
import { TOOLPRINT_VERSION } from "./version.js";

interface ScanCliOptions {
  config?: string;
  update?: boolean;
  failOn: string;
  json?: boolean;
  probe?: boolean;
  lockfile?: string;
  timeout: string;
  telemetry: boolean; // commander maps --no-telemetry to telemetry:false
  color: boolean; // commander maps --no-color to color:false
}

function parseSeverity(value: string): Severity {
  if ((SEVERITIES as string[]).includes(value)) return value as Severity;
  throw new OperationalError(
    `Invalid --fail-on severity: "${value}". Use one of: ${SEVERITIES.join(", ")}.`,
  );
}

/** Exit codes are a documented contract — CI configs depend on them. */
function exitCodeFor(failing: boolean, hadOperationalError: boolean): number {
  if (failing) return 2; // findings at/above --fail-on, or drift
  if (hadOperationalError) return 1; // couldn't connect/parse
  return 0;
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
  const targets = resolveTargets(target, { config: options.config }, cwd);

  const scan = await scanTargets(targets, lockfile, {
    timeoutMs,
    probeOutputs: Boolean(options.probe),
  });

  if (options.update) {
    const scannedServers = scan.results.flatMap((result) => (result.server ? [result.server] : []));
    const next = mergeLockfile(lockfile, scannedServers, new Date().toISOString());
    writeLockfile(lockPath, next);
  }

  if (options.json) {
    process.stdout.write(renderJson(buildJsonReport(scan)));
  } else {
    const color =
      options.color !== false &&
      process.stdout.isTTY === true &&
      process.env.NO_COLOR === undefined;
    process.stdout.write(renderHuman(scan, { color, lockPath, updated: Boolean(options.update) }));
  }

  const failing = scan.findings.some((finding) => meetsThreshold(finding.severity, failOn));
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
    .option("--probe", "reserved: inspect tool outputs (toolprint never executes tools by default)")
    .option("--lockfile <path>", "path to the lockfile (default: nearest toolprint.lock)")
    .option("--timeout <ms>", "per-server timeout in milliseconds", "30000")
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
