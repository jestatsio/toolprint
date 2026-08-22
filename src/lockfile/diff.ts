import type { Capability, ServerCapabilities } from "../model.js";
import { hashCapability } from "./hash.js";
import type { LockedCapability, LockedServer } from "./schema.js";

export interface CapabilityChange {
  name: string;
  /** True when the human-readable description changed (the headline rug-pull
   * vector). False means a non-description field changed (schema, title, etc.). */
  descriptionChanged: boolean;
  before: LockedCapability;
  after: LockedCapability;
}

export interface KindDiff {
  /** Present now but absent from the lock (new, unpinned). */
  added: Capability[];
  /** Pinned in the lock but no longer present. */
  removed: Array<{ name: string; locked: LockedCapability }>;
  /** Present in both but the hash differs. */
  changed: CapabilityChange[];
}

export interface ServerDiff {
  id: string;
  /** The server has no entry in the lockfile yet. */
  isUnpinned: boolean;
  tool: KindDiff;
  prompt: KindDiff;
  resource: KindDiff;
  resourceTemplate: KindDiff;
  skill: KindDiff;
}

function diffKind(current: Capability[], locked: Record<string, LockedCapability>): KindDiff {
  const added: Capability[] = [];
  const changed: CapabilityChange[] = [];
  const seen = new Set<string>();

  for (const capability of current) {
    seen.add(capability.name);
    const before = locked[capability.name];
    const hash = hashCapability(capability.raw);
    if (!before) {
      added.push(capability);
      continue;
    }
    if (before.hash !== hash) {
      changed.push({
        name: capability.name,
        descriptionChanged: (before.description ?? "") !== (capability.description ?? ""),
        before,
        after: { hash, description: capability.description },
      });
    }
  }

  const removed = Object.keys(locked)
    .filter((name) => !seen.has(name))
    .map((name) => ({ name, locked: locked[name] as LockedCapability }));

  return { added, removed, changed };
}

export function diffServer(
  current: ServerCapabilities,
  locked: LockedServer | undefined,
): ServerDiff {
  const empty: Record<string, LockedCapability> = {};
  return {
    id: current.id,
    isUnpinned: locked === undefined,
    tool: diffKind(current.tools, locked?.tools ?? empty),
    prompt: diffKind(current.prompts, locked?.prompts ?? empty),
    resource: diffKind(current.resources, locked?.resources ?? empty),
    resourceTemplate: diffKind(current.resourceTemplates, locked?.resourceTemplates ?? empty),
    skill: diffKind(current.skills, locked?.skills ?? empty),
  };
}

export function kindDiffHasChanges(diff: KindDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}

export function serverDiffHasChanges(diff: ServerDiff): boolean {
  return (
    kindDiffHasChanges(diff.tool) ||
    kindDiffHasChanges(diff.prompt) ||
    kindDiffHasChanges(diff.resource) ||
    kindDiffHasChanges(diff.resourceTemplate) ||
    kindDiffHasChanges(diff.skill)
  );
}
