import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { Finding } from "../checks/types.js";
import { OperationalError } from "../errors.js";
import { findingId } from "./fingerprint.js";

/**
 * Compares a fresh scan against a *prior* scan's JSON report (not the lockfile)
 * and reports what changed. This is the seed of continuous monitoring: stable
 * finding IDs let us say "2 new findings, 1 resolved" since the baseline. It is
 * deliberately **informational** — the exit code stays driven by `--fail-on`.
 */

/** The slice of a `--json` report we need to identify a finding. Other fields
 * are tolerated (`.passthrough()`) so any toolprint report version validates. */
const BaselineFindingSchema = z
  .object({
    checkId: z.string(),
    severity: z.enum(["info", "low", "medium", "high", "critical"]),
    serverId: z.string(),
    capability: z.object({ kind: z.string(), name: z.string() }).optional(),
    title: z.string(),
  })
  .passthrough();

export type BaselineFinding = z.infer<typeof BaselineFindingSchema>;

const BaselineReportSchema = z
  .object({
    // Require the report's identifying field so a wrong JSON file is rejected
    // with a clear error instead of validating as an empty baseline (which would
    // make every current finding look "new").
    toolprintVersion: z.string(),
    servers: z
      .array(z.object({ findings: z.array(BaselineFindingSchema).default([]) }).passthrough())
      .default([]),
  })
  .passthrough();

export interface Baseline {
  path: string;
  findings: BaselineFinding[];
}

/** Read + validate a prior `--json` report. */
export function loadBaseline(path: string): Baseline {
  if (!existsSync(path)) {
    throw new OperationalError(`Baseline file not found: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new OperationalError(`Baseline at ${path} is not valid JSON`, error);
  }
  const result = BaselineReportSchema.safeParse(parsed);
  if (!result.success) {
    throw new OperationalError(
      `Baseline at ${path} is not a toolprint --json report: ${result.error.issues
        .map((i) => i.message)
        .join("; ")}`,
      result.error,
    );
  }
  return { path, findings: result.data.servers.flatMap((s) => s.findings) };
}

export interface BaselineDiff {
  path: string;
  /** In the current scan, absent from the baseline (by stable id). */
  newFindings: Finding[];
  /** In the baseline, absent from the current scan (by stable id). */
  resolvedFindings: BaselineFinding[];
}

/**
 * Diff the current findings against the baseline by stable {@link findingId}.
 * IDs are recomputed for both sides, so a baseline written by an older toolprint
 * (before per-finding `id` existed) compares correctly.
 */
export function diffAgainstBaseline(current: Finding[], baseline: Baseline): BaselineDiff {
  const currentIds = new Set(current.map(findingId));
  const baselineIds = new Set(baseline.findings.map(findingId));
  return {
    path: baseline.path,
    newFindings: current.filter((f) => !baselineIds.has(findingId(f))),
    resolvedFindings: baseline.findings.filter((f) => !currentIds.has(findingId(f))),
  };
}
