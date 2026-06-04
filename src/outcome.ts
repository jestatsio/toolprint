import { RUG_PULL_CHECK_ID } from "./checks/rugpull.js";
import { meetsThreshold, type Finding, type Severity } from "./checks/types.js";

export interface OutcomeOptions {
  /** Minimum severity that fails the run. */
  failOn: Severity;
  /** True for `pin` / `scan --update`. Pinning explicitly accepts drift, so
   * rug-pull findings are excluded from the failure decision; poisoning and
   * secret leaks still gate (you should not silently pin dangerous state). */
  update: boolean;
}

/**
 * The findings that count toward failure. On a verify (`scan`) that's all of
 * them; on a pin it's everything except drift, which is being accepted.
 */
export function gatingFindings(findings: Finding[], update: boolean): Finding[] {
  if (!update) return findings;
  return findings.filter((finding) => finding.checkId !== RUG_PULL_CHECK_ID);
}

export function isFailing(findings: Finding[], options: OutcomeOptions): boolean {
  return gatingFindings(findings, options.update).some((finding) =>
    meetsThreshold(finding.severity, options.failOn),
  );
}

/** Exit codes are a documented contract — CI configs depend on them. */
export function exitCodeFor(failing: boolean, hadOperationalError: boolean): number {
  if (failing) return 2; // findings at/above --fail-on (or drift, on a verify)
  if (hadOperationalError) return 1; // couldn't connect/parse
  return 0;
}
