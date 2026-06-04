import type { ServerDiff } from "../lockfile/diff.js";
import type { CapabilityKind, ServerCapabilities, ServerTarget } from "../model.js";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const SEVERITIES: Severity[] = ["info", "low", "medium", "high", "critical"];

export function meetsThreshold(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[threshold];
}

export interface Finding {
  checkId: string;
  severity: Severity;
  serverId: string;
  capability?: { kind: CapabilityKind; name: string };
  /** Short, scannable headline. */
  title: string;
  /** Human explanation of why it matters. */
  detail: string;
  /** Offending snippet (secrets are redacted before they reach here). */
  evidence?: string;
  /** What the user should do about it. */
  remediation?: string;
  /** For rug-pull description changes: the before/after, for a field-level diff. */
  diff?: { before?: string; after?: string };
}

export interface CheckInput {
  target: ServerTarget;
  server: ServerCapabilities;
  diff: ServerDiff;
  /** Whether `--probe` was passed (reserved for output inspection; we never
   * execute tools by default). */
  probeOutputs: boolean;
}

export interface Check {
  id: string;
  run(input: CheckInput): Finding[];
}
