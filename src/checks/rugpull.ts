import type { KindDiff } from "../lockfile/diff.js";
import { type CapabilityKind, kindLabel } from "../model.js";
import type { Check, CheckInput, Finding } from "./types.js";

/** checkId for every drift finding. Pin/update intentionally does not gate on
 * these (re-pinning accepts the drift); other code filters by this id. */
export const RUG_PULL_CHECK_ID = "rug-pull";

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
  id: RUG_PULL_CHECK_ID,
  run({ server, diff }: CheckInput): Finding[] {
    if (diff.isUnpinned) {
      const count =
        server.tools.length +
        server.prompts.length +
        server.resources.length +
        server.resourceTemplates.length +
        server.skills.length;
      return [
        {
          checkId: RUG_PULL_CHECK_ID,
          severity: "info",
          serverId: server.id,
          title: `${server.transport === "skills" ? "Skills directory" : "Server"} "${server.id}" is not pinned`,
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
      ["resourceTemplate", diff.resourceTemplate],
      ["skill", diff.skill],
    ];

    for (const [kind, kindDiff] of kinds) {
      for (const change of kindDiff.changed) {
        if (change.descriptionChanged) {
          findings.push({
            checkId: RUG_PULL_CHECK_ID,
            severity: "high",
            serverId: server.id,
            capability: { kind, name: change.name },
            title: `${capitalize(kindLabel(kind))} "${change.name}" description changed since it was pinned`,
            detail:
              "The description an agent reads changed after you trusted it — the classic rug-pull / " +
              "tool-poisoning vector. Review the diff before accepting it.",
            diff: { before: change.before.description, after: change.after.description },
            remediation:
              "If the change is legitimate, re-pin with `toolprint scan --update`; otherwise stop using this server.",
          });
        } else {
          findings.push({
            checkId: RUG_PULL_CHECK_ID,
            // High, like a description change: a silent change to a definition you
            // pinned is the rug-pull threat regardless of which field moved, and
            // it's deterministic (a hash compare), so gating it adds no false
            // positives. This is what makes the default `--fail-on high` catch it.
            severity: "high",
            serverId: server.id,
            capability: { kind, name: change.name },
            title: `${capitalize(kindLabel(kind))} "${change.name}" definition changed (${
              kind === "skill" ? "body/frontmatter" : "schema/metadata"
            }) since it was pinned`,
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
          checkId: RUG_PULL_CHECK_ID,
          // A pinned capability vanishing is drift from trusted state too: it can
          // quietly break workflows or mask a swapped server, so it gates by
          // default alongside changed definitions.
          severity: "high",
          serverId: server.id,
          capability: { kind, name: removed.name },
          title: `${capitalize(kindLabel(kind))} "${removed.name}" was pinned but is no longer offered`,
          detail:
            "A capability you pinned disappeared. This can quietly break workflows or mask a swapped server.",
          remediation: "Re-pin with `toolprint scan --update` if this is intentional.",
        });
      }

      for (const added of kindDiff.added) {
        findings.push({
          checkId: RUG_PULL_CHECK_ID,
          severity: "low",
          serverId: server.id,
          capability: { kind, name: added.name },
          title: `New unpinned ${kindLabel(kind)} "${added.name}"`,
          detail:
            "This capability is not in the lockfile yet. New tools should be reviewed before agents rely on them.",
          remediation: "Review, then pin with `toolprint scan --update`.",
        });
      }
    }

    return findings;
  },
};
