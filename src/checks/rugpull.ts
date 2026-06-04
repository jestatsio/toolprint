import type { KindDiff } from "../lockfile/diff.js";
import type { CapabilityKind } from "../model.js";
import type { Check, CheckInput, Finding } from "./types.js";

function capitalize(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * The hero check. Compares live capabilities against the committed lockfile and
 * flags drift — above all, a changed *description*, which is the classic
 * tool-poisoning / rug-pull vector (a server you trusted silently rewrites what
 * an agent reads). Severity is interpreted here; the structural diff is computed
 * in {@link ../lockfile/diff}.
 */
export const rugPullCheck: Check = {
  id: "rug-pull",
  run({ server, diff }: CheckInput): Finding[] {
    if (diff.isUnpinned) {
      const count = server.tools.length + server.prompts.length + server.resources.length;
      return [
        {
          checkId: "rug-pull",
          severity: "info",
          serverId: server.id,
          title: `Server "${server.id}" is not pinned`,
          detail: `No lockfile entry exists for this server, so its ${count} capabilit${
            count === 1 ? "y is" : "ies are"
          } unverified. Pinning lets future scans detect silent changes.`,
          remediation:
            "Run `toolprint scan --update` to pin current definitions into toolprint.lock, then commit it.",
        },
      ];
    }

    const findings: Finding[] = [];
    const kinds: Array<[CapabilityKind, KindDiff]> = [
      ["tool", diff.tool],
      ["prompt", diff.prompt],
      ["resource", diff.resource],
    ];

    for (const [kind, kindDiff] of kinds) {
      for (const change of kindDiff.changed) {
        if (change.descriptionChanged) {
          findings.push({
            checkId: "rug-pull",
            severity: "high",
            serverId: server.id,
            capability: { kind, name: change.name },
            title: `${capitalize(kind)} "${change.name}" description changed since it was pinned`,
            detail:
              "The description an agent reads changed after you trusted it — the classic rug-pull / " +
              "tool-poisoning vector. Review the diff before accepting it.",
            diff: { before: change.before.description, after: change.after.description },
            remediation:
              "If the change is legitimate, re-pin with `toolprint scan --update`; otherwise stop using this server.",
          });
        } else {
          findings.push({
            checkId: "rug-pull",
            severity: "medium",
            serverId: server.id,
            capability: { kind, name: change.name },
            title: `${capitalize(kind)} "${change.name}" definition changed (schema/metadata) since it was pinned`,
            detail:
              "A non-description field (input/output schema, title, annotations) changed. New parameters " +
              "can widen what data a tool receives without touching its description.",
            remediation:
              "Review and re-pin with `toolprint scan --update` if the change is expected.",
          });
        }
      }

      for (const removed of kindDiff.removed) {
        findings.push({
          checkId: "rug-pull",
          severity: "medium",
          serverId: server.id,
          capability: { kind, name: removed.name },
          title: `${capitalize(kind)} "${removed.name}" was pinned but is no longer offered`,
          detail:
            "A capability you pinned disappeared. This can quietly break workflows or mask a swapped server.",
          remediation: "Re-pin with `toolprint scan --update` if this is intentional.",
        });
      }

      for (const added of kindDiff.added) {
        findings.push({
          checkId: "rug-pull",
          severity: "low",
          serverId: server.id,
          capability: { kind, name: added.name },
          title: `New unpinned ${kind} "${added.name}"`,
          detail:
            "This capability is not in the lockfile yet. New tools should be reviewed before agents rely on them.",
          remediation: "Review, then pin with `toolprint scan --update`.",
        });
      }
    }

    return findings;
  },
};
