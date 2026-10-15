import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SEVERITIES, type Severity } from "./checks/types.js";
import { OperationalError } from "./errors.js";
import { executeScan, type ExecuteScanResult } from "./executeScan.js";
import { exitCodeFor } from "./outcome.js";
import { renderHuman } from "./report/human.js";
import { buildJsonReport } from "./report/json.js";
import { TOOLPRINT_VERSION } from "./version.js";

/**
 * `toolprint serve` — the same scanner, exposed as a local MCP server so an
 * agent can check the servers and skills it is about to trust. Two tools,
 * mirroring the CLI's two verbs:
 *
 *   - `scan` is read-only: connect, diff against `toolprint.lock`, report.
 *   - `pin` writes the lockfile. It accepts drift on purpose, exactly like
 *     the CLI, so it is annotated as a write — never call it on unreviewed
 *     changes.
 *
 * Authentication behaves as in the CLI: credentials come from the
 * environment (`TOOLPRINT_BEARER`, `TOOLPRINT_HEADER_*`), so no secret ever
 * travels as a tool argument — tool arguments are visible to the model.
 */

const FailOnSchema = z.enum(SEVERITIES as [Severity, ...Severity[]]);

const ScanArgsSchema = {
  target: z
    .string()
    .optional()
    .describe(
      "What to scan: an MCP config path, an http(s) MCP URL, an `npx:<package>` spec, or a raw server command. Omit to auto-discover the project's MCP config.",
    ),
  config: z
    .string()
    .optional()
    .describe("Path to an MCP client config file (Claude Desktop / VS Code / Cursor)."),
  allClients: z
    .boolean()
    .optional()
    .describe(
      "Discover and scan the MCP config of every agent client installed on this machine (Claude Code, Claude Desktop, Cursor, Zed, and more).",
    ),
  clients: z
    .array(z.string())
    .optional()
    .describe("Scan only these agent client ids, for example `cursor` or `zed`."),
  skills: z
    .union([z.boolean(), z.string()])
    .optional()
    .describe(
      "Scan SKILL.md skill bundles on disk instead of MCP servers: `true` for the default skill roots, or a directory path.",
    ),
  failOn: FailOnSchema.optional().describe(
    "Minimum severity that counts as failing: info, low, medium, high, or critical. Default high.",
  ),
  probe: z
    .boolean()
    .optional()
    .describe(
      "Call tools the server annotates as read-only (a self-report, not verified) with empty arguments and inspect what they return. Off by default; only probe servers the user trusts to execute.",
    ),
  probeTools: z
    .array(z.string())
    .optional()
    .describe("Call these tools by name regardless of annotation. Enables probing on its own."),
  lockfile: z.string().optional().describe("Path to toolprint.lock (default: nearest one)."),
  ignoreFile: z
    .string()
    .optional()
    .describe("Path to toolprint.ignore.json with reviewed false positives."),
  baseline: z
    .string()
    .optional()
    .describe("Path to a prior JSON report, to show findings new or resolved since then."),
  failOnNew: z
    .boolean()
    .optional()
    .describe("With `baseline`, count only newly introduced findings as failing."),
  workingDirectory: z
    .string()
    .optional()
    .describe(
      "Project directory for relative paths and lockfile discovery. Default: this process's working directory.",
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(600_000)
    .optional()
    .describe("Per-server timeout in milliseconds. Default 30000."),
};

type ScanArgs = {
  target?: string;
  config?: string;
  allClients?: boolean;
  clients?: string[];
  skills?: boolean | string;
  failOn?: Severity;
  probe?: boolean;
  probeTools?: string[];
  lockfile?: string;
  ignoreFile?: string;
  baseline?: string;
  failOnNew?: boolean;
  workingDirectory?: string;
  timeoutMs?: number;
};

function resolveCwd(workingDirectory?: string): string {
  // MCP hosts choose this process's cwd (Claude Desktop uses the home
  // directory), so an explicit tool argument wins, then the optional
  // TOOLPRINT_WORKDIR default a bundle can set via user config, then cwd.
  if (!workingDirectory) {
    const fromEnv = process.env.TOOLPRINT_WORKDIR;
    if (fromEnv && existsSync(fromEnv) && statSync(fromEnv).isDirectory()) return fromEnv;
    return process.cwd();
  }
  const cwd = resolve(workingDirectory);
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new OperationalError(`workingDirectory is not a directory: ${workingDirectory}`);
  }
  return cwd;
}

type ToolResponse = {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
};

function toToolResponse(result: ExecuteScanResult, failOn: Severity): ToolResponse {
  const text = renderHuman(result.scan, {
    color: false,
    lockDisplay: result.lockDisplay,
    updated: result.update,
    wrote: result.wrote,
    failOn,
    failing: result.failing,
    baseline: result.baseline,
  });
  const report = buildJsonReport(result.scan, {
    generatedAt: new Date().toISOString(),
    update: result.update
      ? { lockfile: result.lockDisplay, wrote: result.wrote, failed: result.failing }
      : undefined,
    baseline: result.baseline,
  });
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      ...report,
      // The same pass/fail decision the CLI encodes in its exit code, so an
      // agent can branch on it without re-deriving severity thresholds.
      failing: result.failing,
      exitCode: exitCodeFor(result.failing, result.scan.hadOperationalError),
      skipped: result.notes,
      expiredSuppressions: result.expiredSuppressions.map((entry) => entry.id),
      unusedSuppressions: result.unusedSuppressions.map((entry) => entry.id),
    },
  };
}

async function runTool(args: ScanArgs, update: boolean): Promise<ToolResponse> {
  const failOn = args.failOn ?? "high";
  const result = await executeScan({
    cwd: resolveCwd(args.workingDirectory),
    target: args.target,
    config: args.config,
    allClients: args.allClients,
    clients: args.clients ?? [],
    skills: args.skills,
    update,
    failOn,
    probe: args.probe,
    probeTools: args.probeTools ?? [],
    baselinePath: args.baseline,
    failOnNew: args.failOnNew,
    ignoreFile: args.ignoreFile,
    lockfile: args.lockfile,
    timeoutMs: args.timeoutMs ?? 30_000,
    warn: (message) => process.stderr.write(`${message}\n`),
  });
  return toToolResponse(result, failOn);
}

export function createToolprintServer(): McpServer {
  const server = new McpServer(
    { name: "toolprint", version: TOOLPRINT_VERSION },
    {
      instructions:
        "toolprint checks MCP servers and SKILL.md bundles for tool poisoning, leaked secrets, and silent changes since they were pinned in toolprint.lock. Workflow: `scan` to verify (read-only). Use `pin` only after the user has reviewed current definitions, then have them commit the updated toolprint.lock. A `failing: true` result means findings at or above the fail-on severity — surface the findings to the user rather than proceeding with the affected server or skill.",
    },
  );

  server.registerTool(
    "scan",
    {
      title: "Scan MCP servers and skills",
      description:
        "Connect to MCP servers (or read skill bundles), compare every capability against toolprint.lock, and report tool-poisoning, secret-leak, and rug-pull findings. Read-only: never writes the lockfile. Findings at or above `failOn` set `failing: true` and `exitCode: 2` in the structured result.",
      inputSchema: ScanArgsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    (args: ScanArgs) => runTool(args, false),
  );

  server.registerTool(
    "pin",
    {
      title: "Pin current definitions into toolprint.lock",
      description:
        "Scan, then write the current capability definitions into toolprint.lock as the trusted baseline for future scans. Pinning accepts drift, so only call this after the user reviews the changes; poisoning and leaked-secret findings still set `failing: true`. The user should commit the lockfile after a pin.",
      inputSchema: ScanArgsSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args: ScanArgs) => runTool(args, true),
  );

  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createToolprintServer();
  await server.connect(new StdioServerTransport());
  // stdio is the protocol channel — diagnostics belong on stderr only.
  process.stderr.write(`toolprint ${TOOLPRINT_VERSION} MCP server ready (stdio)\n`);
}
