import { createHash } from "node:crypto";
import { relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { Finding, Severity } from "../checks/types.js";
import type { ScanResult } from "../scan.js";
import { TOOLPRINT_VERSION } from "../version.js";

/**
 * SARIF 2.1.0 output for GitHub code scanning. Only the subset of the spec that
 * GitHub ingests is modeled. Each finding becomes a `result`; each check becomes
 * a `rule` carrying a `security-severity` (GitHub reads it from rule properties,
 * not results). Every result needs a physical location, so findings are anchored
 * to the scanned config (or the lockfile) — see {@link SarifOptions.anchorUri}.
 */

export type SarifLevel = "error" | "warning" | "note";

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri: string;
  defaultConfiguration: { level: SarifLevel };
  properties: { tags: string[]; "security-severity": string };
}

export interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine: number };
    };
  }>;
  partialFingerprints: { primaryLocationLineHash: string };
  properties: Record<string, string>;
}

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: Array<{
    tool: {
      driver: {
        name: string;
        informationUri: string;
        version: string;
        rules: SarifRule[];
      };
    };
    results: SarifResult[];
  }>;
}

export interface SarifOptions {
  /** Repo-relative file every result points at (config file, else the lockfile).
   * GitHub will not display a result without a physical location. */
  anchorUri: string;
}

const SCHEMA_URI = "https://json.schemastore.org/sarif-2.1.0.json";
const INFO_URI = "https://github.com/jestatsio/toolprint";
const HELP_URI = "https://github.com/jestatsio/toolprint#what-it-does";

interface RuleMeta {
  name: string;
  short: string;
  full: string;
  /** GitHub buckets: >9 critical, 7–8.9 high, 4–6.9 medium, 0.1–3.9 low. */
  securitySeverity: string;
}

/** Display/group order for rules; also bounds the set of known checks. */
const RULE_ORDER = ["rug-pull", "tool-poisoning", "secret-leak"] as const;

const RULE_META: Record<string, RuleMeta> = {
  "rug-pull": {
    name: "Capability drift (rug-pull)",
    short: "A pinned tool, prompt, or resource definition changed since it was trusted.",
    full:
      "Compares live MCP capabilities against the committed toolprint.lock and flags drift — " +
      "above all a changed description, the text an agent reads and the classic rug-pull vector.",
    securitySeverity: "8.0",
  },
  "tool-poisoning": {
    name: "Tool poisoning",
    short: "Instruction-injection hidden in a tool/prompt description or schema.",
    full:
      "Detects prompt-injection aimed at the model inside descriptions or input-schema fields, " +
      "including invisible and bidirectional-control unicode.",
    securitySeverity: "8.5",
  },
  "secret-leak": {
    name: "Leaked secret in MCP configuration",
    short: "A live-looking credential is embedded in the MCP configuration.",
    full:
      "Flags provider-prefixed or high-entropy credentials in env, headers, or url. " +
      "Secrets are redacted before they appear in any output.",
    securitySeverity: "7.5",
  },
};

function fallbackMeta(checkId: string): RuleMeta {
  return { name: checkId, short: checkId, full: checkId, securitySeverity: "5.0" };
}

function sarifLevel(severity: Severity): SarifLevel {
  if (severity === "critical" || severity === "high") return "error";
  if (severity === "medium") return "warning";
  return "note";
}

/**
 * Repo-relative, forward-slashed URI for a SARIF artifactLocation. Falls back to
 * a `file://` URI when the path escapes cwd — still spec-valid, though GitHub can
 * only annotate files inside the checked-out repo.
 */
export function toArtifactUri(cwd: string, filePath: string): string {
  const rel = relative(cwd, filePath);
  if (rel && !rel.startsWith("..")) return rel.split(sep).join("/");
  return pathToFileURL(filePath).href;
}

function ruleFor(checkId: string): SarifRule {
  const meta = RULE_META[checkId] ?? fallbackMeta(checkId);
  return {
    id: checkId,
    name: meta.name,
    shortDescription: { text: meta.short },
    fullDescription: { text: meta.full },
    helpUri: HELP_URI,
    defaultConfiguration: { level: "error" },
    properties: { tags: ["security", "mcp"], "security-severity": meta.securitySeverity },
  };
}

/** Distinct checks present, in {@link RULE_ORDER} (unknown ids appended stably). */
function rulesFor(findings: Finding[]): SarifRule[] {
  const present = new Set(findings.map((f) => f.checkId));
  const known = RULE_ORDER.filter((id) => present.has(id));
  const unknown = [...present]
    .filter((id) => !(RULE_ORDER as readonly string[]).includes(id))
    .sort();
  return [...known, ...unknown].map(ruleFor);
}

/**
 * Stable identity of a finding, so GitHub tracks one alert across runs instead
 * of churning. Excludes the volatile diff/evidence (which mutate as an attack
 * changes) but keeps the title: a server/capability can carry several findings
 * of the same check (multiple poisoning patterns, multiple leaked secrets), and
 * the title is what distinguishes them. Fields are JSON-encoded so a value
 * containing the delimiter can't collide with the next field.
 */
function fingerprint(finding: Finding): string {
  const key = JSON.stringify([
    finding.checkId,
    finding.serverId,
    finding.capability?.kind ?? null,
    finding.capability?.name ?? null,
    finding.title,
  ]);
  return createHash("sha256").update(key).digest("hex");
}

function messageText(finding: Finding): string {
  const parts: string[] = [finding.title, "", finding.detail];
  if (finding.diff) {
    parts.push(
      "",
      `- ${finding.diff.before ?? "(absent)"}`,
      `+ ${finding.diff.after ?? "(absent)"}`,
    );
  }
  if (finding.evidence) parts.push("", finding.evidence);
  if (finding.remediation) parts.push("", `Remediation: ${finding.remediation}`);
  return parts.join("\n");
}

function resultFor(finding: Finding, ruleIndex: number, anchorUri: string): SarifResult {
  const properties: Record<string, string> = {
    severity: finding.severity,
    serverId: finding.serverId,
  };
  if (finding.capability) {
    properties.capability = `${finding.capability.kind}/${finding.capability.name}`;
  }
  return {
    ruleId: finding.checkId,
    ruleIndex,
    level: sarifLevel(finding.severity),
    message: { text: messageText(finding) },
    locations: [
      { physicalLocation: { artifactLocation: { uri: anchorUri }, region: { startLine: 1 } } },
    ],
    partialFingerprints: { primaryLocationLineHash: fingerprint(finding) },
    properties,
  };
}

export function buildSarifReport(scan: ScanResult, options: SarifOptions): SarifLog {
  const rules = rulesFor(scan.findings);
  const ruleIndex = new Map(rules.map((rule, index) => [rule.id, index]));
  const results = scan.findings.map((finding) => {
    const index = ruleIndex.get(finding.checkId);
    // rulesFor() is built from these same findings, so every checkId has a rule.
    if (index === undefined) throw new Error(`No SARIF rule built for check "${finding.checkId}"`);
    return resultFor(finding, index, options.anchorUri);
  });
  return {
    $schema: SCHEMA_URI,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "toolprint",
            informationUri: INFO_URI,
            version: TOOLPRINT_VERSION,
            rules,
          },
        },
        results,
      },
    ],
  };
}

export function renderSarif(report: SarifLog): string {
  return JSON.stringify(report, null, 2) + "\n";
}
