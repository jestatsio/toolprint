import type { Finding, Severity } from "../checks/types.js";
import type { ScanResult } from "../scan.js";
import { TOOLPRINT_VERSION } from "../version.js";

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

export interface JsonReport {
  toolprintVersion: string;
  schemaVersion: 1;
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
    capabilities?: { tools: number; prompts: number; resources: number };
    findings: Finding[];
  }>;
  /** Present only on `pin` / `scan --update`. */
  update?: UpdateSummary;
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

export function buildJsonReport(scan: ScanResult, update?: UpdateSummary): JsonReport {
  return {
    toolprintVersion: TOOLPRINT_VERSION,
    schemaVersion: 1,
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
            },
          }
        : {}),
      findings: result.findings,
    })),
    ...(update ? { update } : {}),
  };
}

export function renderJson(report: JsonReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}
