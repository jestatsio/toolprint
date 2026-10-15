#!/usr/bin/env node
import { Command, Option } from "commander";
import { SEVERITIES, type Severity } from "./checks/types.js";
import { AGENT_CLIENT_IDS } from "./connect/clients.js";
import { getErrorMessage, OperationalError } from "./errors.js";
import { executeScan } from "./executeScan.js";
import { exitCodeFor } from "./outcome.js";
import { renderHuman } from "./report/human.js";
import { buildJsonReport, renderJson } from "./report/json.js";
import { buildSarifReport, renderSarif, toArtifactUri } from "./report/sarif.js";
import { runStdioServer } from "./server.js";
import { TOOLPRINT_VERSION } from "./version.js";

interface ScanCliOptions {
  config?: string;
  allClients?: boolean;
  client: string[]; // repeated --client; defaults to []
  useSkillroute?: boolean;
  skills?: boolean | string;
  update?: boolean;
  failOn: string;
  json?: boolean;
  sarif?: boolean;
  probe?: boolean;
  probeTool: string[]; // repeated --probe-tool; defaults to []
  baseline?: string;
  failOnNew?: boolean;
  ignoreFile?: string;
  lockfile?: string;
  timeout: string;
  header: string[]; // repeated --header; defaults to []
  bearer?: string;
  // `--no-telemetry` is accepted but does nothing: toolprint has never sent
  // telemetry. Kept so CI pinned to the v1 Action (which passes the flag) keeps
  // working against a newer CLI; removed at the next major.
  telemetry?: boolean;
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

  const result = await executeScan({
    cwd,
    target,
    config: options.config,
    allClients: options.allClients,
    clients: options.client ?? [],
    useSkillroute: options.useSkillroute,
    skills: options.skills,
    update: options.update,
    failOn,
    probe: options.probe,
    probeTools: options.probeTool ?? [],
    baselinePath: options.baseline,
    failOnNew: options.failOnNew,
    ignoreFile: options.ignoreFile,
    lockfile: options.lockfile,
    timeoutMs,
    header: options.header ?? [],
    bearer: options.bearer,
    warn: (message) => process.stderr.write(`${message}\n`),
  });

  // Anything found but not scanned is announced on stderr, so `--json` and
  // `--sarif` stdout stay clean while the gap is never silently hidden.
  for (const note of result.notes) {
    process.stderr.write(`toolprint: skipped ${note.client} (${note.path}): ${note.reason}\n`);
  }
  for (const entry of result.expiredSuppressions) {
    process.stderr.write(
      `toolprint: suppression ${entry.id} expired on ${entry.expires} — it no longer applies (${entry.reason})\n`,
    );
  }
  for (const entry of result.unusedSuppressions) {
    process.stderr.write(
      `toolprint: suppression ${entry.id} matched nothing — remove it from ${result.suppressionsPath}\n`,
    );
  }

  const { scan, baseline, failing, lockDisplay, update, wrote } = result;

  if (options.sarif) {
    // Findings have no source line; anchor them to the scanned config (or the
    // lockfile) so GitHub code scanning can display them.
    const anchorUri = toArtifactUri(cwd, options.config ?? result.lockPath);
    process.stdout.write(renderSarif(buildSarifReport(scan, { anchorUri })));
  } else if (options.json) {
    const updateSummary = update ? { lockfile: lockDisplay, wrote, failed: failing } : undefined;
    process.stdout.write(
      renderJson(
        buildJsonReport(scan, {
          generatedAt: new Date().toISOString(),
          update: updateSummary,
          baseline,
        }),
      ),
    );
  } else {
    const color =
      options.color !== false &&
      process.stdout.isTTY === true &&
      process.env.NO_COLOR === undefined;
    process.stdout.write(
      renderHuman(scan, { color, lockDisplay, updated: update, wrote, failOn, failing, baseline }),
    );
  }

  process.exitCode = exitCodeFor(failing, scan.hadOperationalError);
}
function withScanOptions(command: Command): Command {
  return (
    command
      .option(
        "--config <path>",
        "MCP client config file to scan (Claude Desktop / VS Code / Cursor)",
      )
      .option(
        "--all-clients",
        "discover and scan the MCP config of every agent client installed on this machine",
      )
      .option(
        "--client <id>",
        `scan only this agent client (repeatable): ${AGENT_CLIENT_IDS.join(", ")}`,
        collect,
        [],
      )
      .option(
        "--skills [dir]",
        "scan SKILL.md bundles on disk instead of an MCP server (defaults to .claude/skills, ~/.claude/skills, and plugin skills)",
      )
      .option(
        "--use-skillroute",
        "with --all-clients, also run `skillroute harness detect --json` to locate clients (executes the skillroute CLI; off by default)",
      )
      .option(
        "--fail-on <severity>",
        "minimum severity that fails the scan (info|low|medium|high|critical)",
        "high",
      )
      .option("--json", "output machine-readable JSON")
      .option("--sarif", "output SARIF 2.1.0 for GitHub code scanning")
      .option(
        "--probe",
        "EXECUTE tools the server annotates read-only (readOnlyHint — self-reported, not verified) with empty args and inspect their output (off by default; only probe servers you trust)",
      )
      .option(
        "--probe-tool <name>",
        "execute this tool by name regardless of annotation (repeatable); enables probing on its own",
        collect,
        [],
      )
      .option(
        "--baseline <path>",
        "compare against a prior --json report and show findings new/resolved since then (informational; does not affect the exit code)",
      )
      .option(
        "--fail-on-new",
        "with --baseline, fail only on findings that are new since the baseline (pre-existing ones still report)",
      )
      .option(
        "--ignore-file <path>",
        "reviewed false positives to exclude from the failure decision (default: toolprint.ignore.json)",
      )
      .option("--lockfile <path>", "path to the lockfile (default: nearest toolprint.lock)")
      .option("--timeout <ms>", "per-server timeout in milliseconds", "30000")
      .option(
        "--header <header>",
        'add an HTTP header to http(s)/sse targets, e.g. --header "Authorization: Bearer $TOKEN" (repeatable)',
        collect,
        [],
      )
      .option("--bearer <token>", 'shorthand for --header "Authorization: Bearer <token>"')
      // Hidden no-op: toolprint sends no telemetry. See ScanCliOptions.
      .addOption(new Option("--no-telemetry").hideHelp())
      .option("--no-color", "disable colored output")
  );
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

program
  .command("serve")
  .description(
    "Run toolprint as a local MCP server over stdio (tools: scan, pin) for Claude Code, Codex, and Claude Desktop",
  )
  .action(async () => {
    await runStdioServer();
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    process.stderr.write(`toolprint: ${getErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
