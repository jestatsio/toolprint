import { RUG_PULL_CHECK_ID } from "./checks/rugpull.js";
import { meetsThreshold, type Finding, type Severity } from "./checks/types.js";
import { findingId } from "./report/fingerprint.js";

export interface OutcomeOptions {
  /** Minimum severity that fails the run. */
  failOn: Severity;
  /** When set (`--fail-on-new`), only findings with these ids can fail the run. */
  newFindingIds?: Set<string>;
  /** True for `pin` / `scan --update`. Pinning explicitly accepts drift, so
   * rug-pull findings are excluded from the failure decision; poisoning and
   * secret leaks still gate (you should not silently pin dangerous state). */
  update: boolean;
}

/**
 * The findings that count toward failure. On a verify (`scan`) that's all of
 * them; on a pin it's everything except drift, which is being accepted. A
 * finding covered by `toolprint.ignore.json` never gates — it is still
 * reported, just not enforced.
 */
export function gatingFindings(findings: Finding[], update: boolean): Finding[] {
  const enforceable = findings.filter((finding) => finding.suppressed !== true);
  if (!update) return enforceable;
  return enforceable.filter((finding) => finding.checkId !== RUG_PULL_CHECK_ID);
}

export function isFailing(findings: Finding[], options: OutcomeOptions): boolean {
  const candidates = gatingFindings(findings, options.update);
  // `--fail-on-new` narrows the gate to findings absent from the baseline, so a
  // team can adopt toolprint on a dirty repo and still block anything newly
  // introduced. Identity comes from the same stable finding id as --baseline.
  const gated = options.newFindingIds
    ? candidates.filter((finding) => options.newFindingIds?.has(findingId(finding)))
    : candidates;
  return gated.some((finding) => meetsThreshold(finding.severity, options.failOn));
}

/** Exit codes are a documented contract — CI configs depend on them. */
export function exitCodeFor(failing: boolean, hadOperationalError: boolean): number {
  if (failing) return 2; // findings at/above --fail-on (or drift, on a verify)
  if (hadOperationalError) return 1; // couldn't connect/parse
  return 0;
}
