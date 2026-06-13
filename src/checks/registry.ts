import { outputInspectionCheck } from "./outputInspection.js";
import { rugPullCheck } from "./rugpull.js";
import { secretLeakCheck } from "./secretLeak.js";
import { toolPoisoningCheck } from "./toolPoisoning.js";
import type { Check, CheckInput, Finding } from "./types.js";

/** The check set. Order is the display order in reports. `tool-output` only
 * produces findings when `--probe` executed tools. */
export const DEFAULT_CHECKS: Check[] = [
  rugPullCheck,
  toolPoisoningCheck,
  secretLeakCheck,
  outputInspectionCheck,
];

export function runChecks(input: CheckInput, checks: Check[] = DEFAULT_CHECKS): Finding[] {
  return checks.flatMap((check) => check.run(input));
}
