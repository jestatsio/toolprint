import { MAX_JSON_DEPTH } from "../limits.js";
import { type Capability, type CapabilityKind, kindLabel } from "../model.js";
import { type PoisonHit, scanTextForPoisoning } from "./patterns/poisoning.js";
import type { Check, CheckInput, Finding } from "./types.js";

interface TextSource {
  where: string;
  text: string;
}

/** Field names whose string value is read by the model as guidance. `instructions`
 * carries a skill bundle's body — the same trust surface as a tool description. */
const AGENT_READ_KEYS = new Set(["description", "title", "instructions"]);

/**
 * Every human-readable string an agent might read: `description`, `title`, and
 * `instructions` fields anywhere in the capability — top-level, tool
 * input/output schemas, prompt arguments, resource metadata, a skill bundle's
 * body — each tagged with its JSON path so the evidence points at exactly where
 * an instruction hides. Treating every capability kind uniformly is what gives
 * prompts, resources, and skills the same poisoning coverage as tools.
 */
function textSources(capability: Capability): TextSource[] {
  const sources: TextSource[] = [];
  collectText(capability.raw, "", sources);
  return sources;
}

function collectText(value: unknown, path: string, acc: TextSource[], depth = 0): void {
  // Bounded so a hostile server can't blow the stack with pathological JSON.
  if (depth > MAX_JSON_DEPTH || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectText(item, `${path}[${index}]`, acc, depth + 1));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "_meta") continue; // runtime metadata, not an agent-read field
    const childPath = path ? `${path}.${key}` : key;
    if (AGENT_READ_KEYS.has(key) && typeof child === "string") {
      acc.push({ where: childPath, text: child });
    } else {
      collectText(child, childPath, acc, depth + 1);
    }
  }
}

function detailFor(hit: PoisonHit, kind: CapabilityKind): string {
  if (hit.id === "hidden-unicode") {
    return (
      "This text contains zero-width or bidirectional-control characters, which can hide " +
      "instructions from a human reviewer while the model still reads them."
    );
  }
  if (hit.id === "encoded-blob") {
    return "A long base64-like run in this text is unusual and can carry a hidden payload.";
  }
  return (
    `This text is read by the model when it works with this ${kindLabel(kind)}. ` +
    "Embedded instructions can hijack an agent (prompt injection / tool poisoning)."
  );
}

/** What the user would stop using: a skill bundle stands alone, everything else
 * belongs to a server. */
function sourceNoun(kind: CapabilityKind): string {
  return kind === "skill" ? "skill" : "server";
}

function remediationFor(hit: PoisonHit, kind: CapabilityKind): string {
  if (hit.id === "hidden-unicode") {
    return "Treat as malicious unless you can explain the hidden characters.";
  }
  if (hit.id === "encoded-blob") return "Decode and verify the blob is benign.";
  return `Confirm this wording is intentional and benign; if not, stop using this ${sourceNoun(kind)}.`;
}

function inspect(capability: Capability, kind: CapabilityKind, serverId: string): Finding[] {
  const findings: Finding[] = [];
  // Distinct high-severity vectors across all of a capability's text. Two or
  // more independent ones co-occurring is the critical "combined attack" signal.
  const highVectors = new Map<string, string>();

  for (const source of textSources(capability)) {
    for (const hit of scanTextForPoisoning(source.text, source.where)) {
      if (hit.severity === "high") highVectors.set(hit.id, hit.label);
      findings.push({
        checkId: "tool-poisoning",
        severity: hit.severity,
        serverId,
        capability: { kind, name: capability.name },
        title: `${hit.label} in ${kindLabel(kind)} "${capability.name}"`,
        detail: detailFor(hit, kind),
        evidence: hit.evidence,
        remediation: remediationFor(hit, kind),
      });
    }
  }

  if (highVectors.size >= 2) {
    findings.push({
      checkId: "tool-poisoning",
      severity: "critical",
      serverId,
      capability: { kind, name: capability.name },
      title: `Multiple independent injection vectors in ${kindLabel(kind)} "${capability.name}"`,
      detail:
        "Two or more independent high-severity injection signals occur in the same " +
        "capability (for example an instruction-override together with hidden unicode). " +
        "A combination this deliberate is almost never accidental.",
      evidence: `vectors: ${[...highVectors.values()].join(", ")}`,
      remediation: `Treat this ${sourceNoun(kind)} as malicious and stop using it.`,
    });
  }

  return findings;
}

export const toolPoisoningCheck: Check = {
  id: "tool-poisoning",
  run({ server }: CheckInput): Finding[] {
    const findings: Finding[] = [];
    for (const tool of server.tools) findings.push(...inspect(tool, "tool", server.id));
    for (const prompt of server.prompts) findings.push(...inspect(prompt, "prompt", server.id));
    for (const resource of server.resources) {
      findings.push(...inspect(resource, "resource", server.id));
    }
    for (const template of server.resourceTemplates) {
      findings.push(...inspect(template, "resourceTemplate", server.id));
    }
    for (const skill of server.skills) findings.push(...inspect(skill, "skill", server.id));
    return findings;
  },
};
