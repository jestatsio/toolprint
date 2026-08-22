import type { ServerTarget } from "../model.js";
import { scanValueForSecrets, type SecretHit } from "./patterns/secrets.js";
import type { Check, CheckInput, Finding } from "./types.js";

interface Location {
  where: string;
  value: string;
  /** Whether to run the entropy heuristic here (only high-confidence spots). */
  entropy: boolean;
}

function configLocations(target: ServerTarget): Location[] {
  const out: Location[] = [];
  for (const [key, value] of Object.entries(target.env ?? {})) {
    out.push({ where: `env.${key}`, value, entropy: true });
  }
  for (const [key, value] of Object.entries(target.headers ?? {})) {
    out.push({ where: `headers.${key}`, value, entropy: true });
  }
  (target.args ?? []).forEach((arg, i) =>
    out.push({ where: `args[${i}]`, value: arg, entropy: false }),
  );
  if (target.url) out.push({ where: "url", value: target.url, entropy: false });
  return out;
}

function findingFor(hit: SecretHit, serverId: string): Finding {
  if (hit.id === "entropy") {
    return {
      checkId: "secret-leak",
      severity: hit.severity,
      serverId,
      title: `High-entropy value in ${hit.where} (possible secret)`,
      detail:
        "This value looks random enough to be a credential. If it is, it should not live in the config.",
      evidence: hit.evidence,
      remediation: "If this is a secret, move it to a secret manager and rotate it.",
    };
  }
  return {
    checkId: "secret-leak",
    severity: hit.severity,
    serverId,
    title: `Possible ${hit.label} in ${hit.where}`,
    detail:
      "A live-looking credential is embedded in the MCP configuration. Anyone with the config " +
      "(or the repo it's committed to) can read it.",
    evidence: hit.evidence,
    remediation:
      "Move it to an environment variable or secret manager, then rotate the exposed key.",
  };
}

export const secretLeakCheck: Check = {
  id: "secret-leak",
  run({ target, server }: CheckInput): Finding[] {
    const findings: Finding[] = [];

    for (const location of configLocations(target)) {
      for (const hit of scanValueForSecrets(location.value, location.where, {
        entropy: location.entropy,
      })) {
        findings.push(findingFor(hit, server.id));
      }
    }

    // Also scan capability descriptions for accidentally-embedded keys.
    const caps = [
      ...server.tools,
      ...server.prompts,
      ...server.resources,
      ...server.resourceTemplates,
      ...server.skills,
    ];
    for (const cap of caps) {
      if (!cap.description) continue;
      const where = `${cap.kind} "${cap.name}" description`;
      for (const hit of scanValueForSecrets(cap.description, where, { entropy: false })) {
        findings.push({
          ...findingFor(hit, server.id),
          capability: { kind: cap.kind, name: cap.name },
        });
      }
    }

    return findings;
  },
};
