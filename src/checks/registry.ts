import { rugPullCheck } from "./rugpull.js";
import { secretLeakCheck } from "./secretLeak.js";
import { toolPoisoningCheck } from "./toolPoisoning.js";
import type { Check, CheckInput, Finding } from "./types.js";

/** The MVP check set. Order is the display order in reports. */
export const DEFAULT_CHECKS: Check[] = [rugPullCheck, toolPoisoningCheck, secretLeakCheck];

export function runChecks(input: CheckInput, checks: Check[] = DEFAULT_CHECKS): Finding[] {
  return checks.flatMap((check) => check.run(input));
}
