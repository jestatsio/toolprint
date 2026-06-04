import { RUG_PULL_CHECK_ID } from "../checks/rugpull.js";
import type { Finding, Severity } from "../checks/types.js";
import { SEVERITY_ORDER } from "../checks/types.js";
import type { KindDiff, ServerDiff } from "../lockfile/diff.js";
import { type CapabilityKind, kindLabel, type ServerCapabilities } from "../model.js";
import type { ScanResult, ServerScanResult } from "../scan.js";
import { TOOLPRINT_VERSION } from "../version.js";
import { FEEDBACK_URL, TEAMS_URL } from "./footer.js";

export interface HumanReportOptions {
  color: boolean;
  /** Lockfile path to show, already made cwd-relative by the caller. */
  lockDisplay: string;
  /** True for `pin` / `scan --update`: drift is rendered as accepted ("Pinned")
   * rather than as findings. */
  updated: boolean;
  /** Whether the lockfile was actually written (false on a no-op re-pin). */
  wrote: boolean;
}

/** Findings to display for a result. On a pin, drift is shown as the "Pinned"
 * section instead, so it's filtered out of the findings list here. */
function shownFindings(findings: Finding[], updated: boolean): Finding[] {
  if (!updated) return findings;
  return findings.filter((finding) => finding.checkId !== RUG_PULL_CHECK_ID);
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
  if (server.resourceTemplates.length) {
    parts.push(pluralize(server.resourceTemplates.length, "resource template"));
  }
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

function serverStatusLine(p: Palette, result: ServerScanResult, findings: Finding[]): string {
  const label = `${result.target.id} ${p.gray(`(${result.target.transport})`)}`;
  if (result.error) {
    return `  ${p.red("x")} ${label} ${p.gray("-")} ${p.red(`could not connect: ${result.error}`)}`;
  }
  const caps = result.server ? capabilitySummary(result.server) : "";
  const counts = countBySeverity(findings);
  const hasHigh = counts.critical > 0 || counts.high > 0;
  const hasFindings = findings.length > 0;
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
    ? `${finding.serverId} ${p.gray("·")} ${kindLabel(finding.capability.kind)} "${finding.capability.name}"`
    : finding.serverId;
  const lines: string[] = [`  ${tag} ${p.gray(finding.checkId)}  ${location}`];
  lines.push(`      ${finding.title}`);
  if (finding.diff) lines.push(...renderDiff(p, finding.diff.before, finding.diff.after));
  if (finding.evidence) lines.push(`      ${p.gray(finding.evidence)}`);
  if (finding.remediation) lines.push(`      ${p.cyan(`-> ${finding.remediation}`)}`);
  return lines;
}

const PIN_KINDS: CapabilityKind[] = ["tool", "prompt", "resource", "resourceTemplate"];

function kindDiffOf(diff: ServerDiff, kind: CapabilityKind): KindDiff {
  if (kind === "tool") return diff.tool;
  if (kind === "prompt") return diff.prompt;
  if (kind === "resource") return diff.resource;
  return diff.resourceTemplate;
}

/** Calm "here's what I just pinned" view of a server's accepted drift. Unlike a
 * finding, it carries no severity — the user chose to trust this state. */
function renderServerPin(p: Palette, result: ServerScanResult): string[] {
  const { server, diff } = result;
  const id = p.bold(result.target.id);
  // A server that failed to connect was not pinned — say so, don't drop it
  // silently from the section (the lockfile keeps its previous entry, if any).
  if (!server || !diff) {
    return [`  ${id} ${p.gray("·")} ${p.yellow("skipped")} ${p.gray("(could not connect)")}`];
  }

  // First-time pin: every capability is new, so a count beats a long list.
  if (diff.isUnpinned) {
    return [`  ${id} ${p.gray("·")} pinned ${p.gray(capabilitySummary(server))}`];
  }

  const lines: string[] = [];
  for (const kind of PIN_KINDS) {
    const label = kindLabel(kind);
    const kindDiff = kindDiffOf(diff, kind);
    for (const change of kindDiff.changed) {
      const what = change.descriptionChanged
        ? "description updated"
        : "definition updated (schema/metadata)";
      lines.push(`  ${id} ${p.gray("·")} ${label} "${change.name}" ${p.gray(what)}`);
      if (change.descriptionChanged) {
        lines.push(...renderDiff(p, change.before.description, change.after.description));
      }
    }
    for (const removed of kindDiff.removed) {
      lines.push(`  ${id} ${p.gray("·")} ${label} "${removed.name}" ${p.gray("removed")}`);
    }
    if (kindDiff.added.length > 0) {
      lines.push(
        `  ${id} ${p.gray("·")} ${p.gray(`+${pluralize(kindDiff.added.length, `new ${label}`)}`)}`,
      );
    }
  }
  return lines;
}

function renderPinned(p: Palette, results: ServerScanResult[]): string[] {
  const body = results.flatMap((result) => renderServerPin(p, result));
  if (body.length === 0) return [];
  return [p.bold("Pinned:"), ...body, ""];
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

  for (const result of scan.results) {
    lines.push(serverStatusLine(p, result, shownFindings(result.findings, options.updated)));
  }

  const displayed = shownFindings(scan.findings, options.updated);
  const sortedFindings = [...displayed].sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
  );
  lines.push("");
  for (const finding of sortedFindings) {
    lines.push(...renderFinding(p, finding));
    lines.push("");
  }

  if (options.updated) lines.push(...renderPinned(p, scan.results));

  const totals = countBySeverity(displayed);
  const errorCount = scan.results.filter((r) => r.error).length;
  const errorNote =
    errorCount > 0 ? ` ${p.gray(`(${pluralize(errorCount, "connection error")})`)}` : "";
  lines.push(
    `${p.bold("Summary:")} ${summarizeCounts(totals)} across ${pluralize(scan.results.length, "server")}${errorNote}`,
  );

  const lockDisplay = options.lockDisplay;
  if (options.updated) {
    lines.push(
      options.wrote
        ? p.gray(`Pinned to ${lockDisplay} — review the diff and commit it.`)
        : p.gray(`Already up to date: ${lockDisplay}.`),
    );
  } else if (scan.results.some((r) => r.diff?.isUnpinned)) {
    lines.push(
      p.gray(
        `Some servers are unpinned. Run \`toolprint scan --update\` to create ${lockDisplay}.`,
      ),
    );
  }

  if (displayed.length > 0) {
    lines.push("");
    lines.push(p.gray(`Real issue or a false positive? Tell us: ${FEEDBACK_URL}`));
    lines.push(p.gray(`Want continuous monitoring across your repos? ${TEAMS_URL}`));
  }

  lines.push("");
  return lines.join("\n");
}
