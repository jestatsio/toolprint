import type { Finding, Severity } from "../checks/types.js";
import type { ScanResult } from "../scan.js";
import { TOOLPRINT_VERSION } from "../version.js";
import type { BaselineDiff } from "./baseline.js";
import { findingId } from "./fingerprint.js";

/**
 * Stable machine-readable report. This schema is a contract: CI configs and any
 * future API depend on it, so add fields rather than renaming/removing them.
 */
export interface UpdateSummary {
  /** Lockfile path, relative to cwd when possible. */
  lockfile: string;
  /** False on a no-op re-pin (content already matched). */
  wrote: boolean;
  /** True when the pin still exits non-zero — a tool-poisoning or secret-leak
   * finding gated it. Accepted drift (rug-pull) never sets this, so consumers
   * get the same pass/fail decision the CLI makes without filtering findings. */
  failed: boolean;
}

/** A finding plus its stable {@link findingId}, so consumers can track one
 * finding across runs (the same id powers SARIF fingerprints and --baseline). */
export type ReportedFinding = Finding & { id: string };

export interface JsonReport {
  toolprintVersion: string;
  schemaVersion: 1;
  /** ISO-8601 time the scan was rendered. Lets dashboards order runs. */
  generatedAt: string;
  summary: {
    servers: number;
    findings: number;
    bySeverity: Record<Severity, number>;
    operationalErrors: number;
  };
  servers: Array<{
    id: string;
    transport: string;
    source: string;
    error?: string;
    capabilities?: {
      tools: number;
      prompts: number;
      resources: number;
      resourceTemplates: number;
      skills: number;
    };
    findings: ReportedFinding[];
  }>;
  /** Present only on `pin` / `scan --update`. */
  update?: UpdateSummary;
  /** Present only with `--baseline`: findings new/resolved since the prior scan. */
  baseline?: {
    path: string;
    new: ReportedFinding[];
    resolved: BaselineDiff["resolvedFindings"];
  };
}

export interface JsonReportOptions {
  /** Injected by the caller so buildJsonReport stays pure/testable (mirrors how
   * mergeLockfile takes its timestamp). */
  generatedAt: string;
  update?: UpdateSummary;
  baseline?: BaselineDiff;
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

function withId(finding: Finding): ReportedFinding {
  return { ...finding, id: findingId(finding) };
}

export function buildJsonReport(scan: ScanResult, options: JsonReportOptions): JsonReport {
  return {
    toolprintVersion: TOOLPRINT_VERSION,
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    summary: {
      servers: scan.results.length,
      findings: scan.findings.length,
      bySeverity: countBySeverity(scan.findings),
      operationalErrors: scan.results.filter((result) => result.error).length,
    },
    servers: scan.results.map((result) => ({
      id: result.target.id,
      transport: result.target.transport,
      source: result.target.source,
      ...(result.error ? { error: result.error } : {}),
      ...(result.server
        ? {
            capabilities: {
              tools: result.server.tools.length,
              prompts: result.server.prompts.length,
              resources: result.server.resources.length,
              resourceTemplates: result.server.resourceTemplates.length,
              skills: result.server.skills.length,
            },
          }
        : {}),
      findings: result.findings.map(withId),
    })),
    ...(options.update ? { update: options.update } : {}),
    ...(options.baseline
      ? {
          baseline: {
            path: options.baseline.path,
            new: options.baseline.newFindings.map(withId),
            resolved: options.baseline.resolvedFindings,
          },
        }
      : {}),
  };
}

export function renderJson(report: JsonReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}
