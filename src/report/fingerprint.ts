import { createHash } from "node:crypto";

/**
 * Stable identity of a finding, so a consumer (GitHub code scanning, a baseline
 * diff, a future dashboard) can track one finding across runs instead of
 * churning. Excludes the volatile diff/evidence (which mutate as an attack
 * changes) but keeps the title: a server/capability can carry several findings
 * of the same check (multiple poisoning patterns, multiple leaked secrets), and
 * the title is what distinguishes them. Fields are JSON-encoded so a value
 * containing the delimiter can't collide with the next field.
 */
/** The structural subset of a Finding that determines its identity. Defined
 * loosely (string `kind`) so both a live Finding and a finding parsed from a
 * prior JSON report satisfy it. */
export interface FindingIdentity {
  checkId: string;
  serverId: string;
  capability?: { kind: string; name: string };
  title: string;
}

export function findingId(finding: FindingIdentity): string {
  const key = JSON.stringify([
    finding.checkId,
    finding.serverId,
    finding.capability?.kind ?? null,
    finding.capability?.name ?? null,
    finding.title,
  ]);
  return createHash("sha256").update(key).digest("hex");
}
