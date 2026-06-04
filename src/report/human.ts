import { relative } from "node:path";
import type { Finding, Severity } from "../checks/types.js";
import { SEVERITY_ORDER } from "../checks/types.js";
import type { ServerCapabilities } from "../model.js";
import type { ScanResult, ServerScanResult } from "../scan.js";
import { TOOLPRINT_VERSION } from "../version.js";
import { FEEDBACK_URL, TEAMS_URL } from "./footer.js";

export interface HumanReportOptions {
  color: boolean;
  lockPath: string;
  updated: boolean;
}

type Colorize = (text: string) => string;

interface Palette {
  red: Colorize;
  green: Colorize;
  yellow: Colorize;
  blue: Colorize;
  gray: Colorize;
  bold: Colorize;
  cyan: Colorize;
}

// Built at runtime to avoid embedding a literal ESC control char in source.
const ESC = String.fromCharCode(27);

function palette(enabled: boolean): Palette {
  const wrap =
    (code: number): Colorize =>
    (text) =>
      enabled ? `${ESC}[${code}m${text}${ESC}[0m` : text;
  return {
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    blue: wrap(34),
    gray: wrap(90),
    bold: wrap(1),
    cyan: wrap(36),
  };
}

const SEVERITY_TAG: Record<Severity, string> = {
  critical: "CRIT",
  high: "HIGH",
  medium: "MED ",
  low: "LOW ",
  info: "INFO",
};

const SEVERITY_ORDER_DESC: Severity[] = ["critical", "high", "medium", "low", "info"];

function severityColor(p: Palette, severity: Severity): Colorize {
  switch (severity) {
    case "critical":
    case "high":
      return p.red;
    case "medium":
      return p.yellow;
    case "low":
      return p.blue;
    case "info":
      return p.gray;
  }
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function capabilitySummary(server: ServerCapabilities): string {
  const parts: string[] = [];
  if (server.tools.length) parts.push(pluralize(server.tools.length, "tool"));
  if (server.prompts.length) parts.push(pluralize(server.prompts.length, "prompt"));
  if (server.resources.length) parts.push(pluralize(server.resources.length, "resource"));
  return parts.length ? parts.join(", ") : "no capabilities";
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function summarizeCounts(counts: Record<Severity, number>): string {
  const parts = SEVERITY_ORDER_DESC.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`);
  return parts.length ? parts.join(", ") : "clean";
}

function serverStatusLine(p: Palette, result: ServerScanResult): string {
  const label = `${result.target.id} ${p.gray(`(${result.target.transport})`)}`;
  if (result.error) {
    return `  ${p.red("x")} ${label} ${p.gray("-")} ${p.red(`could not connect: ${result.error}`)}`;
  }
  const caps = result.server ? capabilitySummary(result.server) : "";
  const counts = countBySeverity(result.findings);
  const hasHigh = counts.critical > 0 || counts.high > 0;
  const hasFindings = result.findings.length > 0;
  const icon = hasHigh ? p.red("x") : hasFindings ? p.yellow("!") : p.green("ok");
  const status = hasFindings ? summarizeCounts(counts) : p.green("clean");
  return `  ${icon} ${label} ${p.gray("-")} ${p.gray(caps)} ${p.gray("-")} ${status}`;
}

function renderDiff(p: Palette, before: string | undefined, after: string | undefined): string[] {
  const lines: string[] = [];
  for (const line of (before ?? "(absent)").split("\n")) lines.push(`      ${p.red(`- ${line}`)}`);
  for (const line of (after ?? "(absent)").split("\n")) lines.push(`      ${p.green(`+ ${line}`)}`);
  return lines;
}

function renderFinding(p: Palette, finding: Finding): string[] {
  const tag = severityColor(p, finding.severity)(p.bold(SEVERITY_TAG[finding.severity]));
  const location = finding.capability
    ? `${finding.serverId} ${p.gray("·")} ${finding.capability.kind} "${finding.capability.name}"`
    : finding.serverId;
  const lines: string[] = [`  ${tag} ${p.gray(finding.checkId)}  ${location}`];
  lines.push(`      ${finding.title}`);
  if (finding.diff) lines.push(...renderDiff(p, finding.diff.before, finding.diff.after));
  if (finding.evidence) lines.push(`      ${p.gray(finding.evidence)}`);
  if (finding.remediation) lines.push(`      ${p.cyan(`-> ${finding.remediation}`)}`);
  return lines;
}

export function renderHuman(scan: ScanResult, options: HumanReportOptions): string {
  const p = palette(options.color);
  const lines: string[] = [];

  lines.push("");
  lines.push(
    `${p.bold("toolprint")} ${p.gray(`v${TOOLPRINT_VERSION}`)} ${p.gray("-")} ${pluralize(
      scan.results.length,
      "server",
    )}`,
  );
  lines.push("");

  for (const result of scan.results) lines.push(serverStatusLine(p, result));

  const sortedFindings = [...scan.findings].sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
  );
  lines.push("");
  for (const finding of sortedFindings) {
    lines.push(...renderFinding(p, finding));
    lines.push("");
  }

  const totals = countBySeverity(scan.findings);
  const errorCount = scan.results.filter((r) => r.error).length;
  const errorNote =
    errorCount > 0 ? ` ${p.gray(`(${pluralize(errorCount, "connection error")})`)}` : "";
  lines.push(
    `${p.bold("Summary:")} ${summarizeCounts(totals)} across ${pluralize(scan.results.length, "server")}${errorNote}`,
  );

  const lockDisplay = relative(process.cwd(), options.lockPath) || options.lockPath;
  if (options.updated) {
    lines.push(p.gray(`Lockfile written: ${lockDisplay} (review the diff and commit it).`));
  } else if (scan.results.some((r) => r.diff?.isUnpinned)) {
    lines.push(
      p.gray(
        `Some servers are unpinned. Run \`toolprint scan --update\` to create ${lockDisplay}.`,
      ),
    );
  }

  if (scan.findings.length > 0) {
    lines.push("");
    lines.push(p.gray(`Real issue or a false positive? Tell us: ${FEEDBACK_URL}`));
    lines.push(p.gray(`Want continuous monitoring across your repos? ${TEAMS_URL}`));
  }

  lines.push("");
  return lines.join("\n");
}
