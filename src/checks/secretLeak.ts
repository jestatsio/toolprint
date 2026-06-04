import type { ServerTarget } from "../model.js";
import type { Check, CheckInput, Finding } from "./types.js";

interface SecretPattern {
  id: string;
  label: string;
  re: RegExp;
}

/** High-confidence, provider-prefixed credential shapes. Conservative lengths
 * to avoid matching short placeholders. */
const SECRET_PATTERNS: SecretPattern[] = [
  { id: "openai", label: "OpenAI API key", re: /sk-(proj-)?[A-Za-z0-9_-]{20,}/ },
  { id: "stripe", label: "Stripe secret key", re: /[rs]k_(live|test)_[A-Za-z0-9]{20,}/ },
  { id: "github", label: "GitHub token", re: /gh[opsur]_[A-Za-z0-9]{36,}/ },
  { id: "github-pat", label: "GitHub fine-grained PAT", re: /github_pat_[A-Za-z0-9_]{60,}/ },
  { id: "slack", label: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: "aws", label: "AWS access key id", re: /(AKIA|ASIA)[0-9A-Z]{16}/ },
  { id: "google", label: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { id: "gitlab", label: "GitLab PAT", re: /glpat-[A-Za-z0-9_-]{20,}/ },
  { id: "private-key", label: "Private key", re: /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/ },
  { id: "jwt", label: "JWT", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/ },
];

const ENTROPY_MIN = 4.0;
const ENTROPY_MIN_LENGTH = 24;

function isPlaceholder(value: string): boolean {
  return (
    value.trim() === "" ||
    /\$\{|\$\(|\{\{/.test(value) ||
    /<[^>]+>/.test(value) ||
    /\b(your|my|example|placeholder|changeme|change_me|dummy|sample|fake|redacted|todo|none|null|insert)\b/i.test(
      value,
    ) ||
    /x{4,}/i.test(value) ||
    /\*{3,}/.test(value)
  );
}

function shannonEntropy(value: string): number {
  const freq = new Map<string, number>();
  for (const char of value) freq.set(char, (freq.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Show enough to recognize the secret, never enough to use it. */
function redact(secret: string): string {
  const len = secret.length;
  if (len <= 8) return `${secret.slice(0, 2)}*** (${len} chars, redacted)`;
  return `${secret.slice(0, 4)}…${secret.slice(-2)} (${len} chars, redacted)`;
}

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

function matchPrefix(location: Location, serverId: string): Finding[] {
  if (isPlaceholder(location.value)) return [];
  const findings: Finding[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const match = pattern.re.exec(location.value);
    if (match) {
      findings.push({
        checkId: "secret-leak",
        severity: "high",
        serverId,
        title: `Possible ${pattern.label} in ${location.where}`,
        detail:
          "A live-looking credential is embedded in the MCP configuration. Anyone with the config " +
          "(or the repo it's committed to) can read it.",
        evidence: `${location.where} = ${redact(match[0])}`,
        remediation:
          "Move it to an environment variable or secret manager, then rotate the exposed key.",
      });
    }
  }
  return findings;
}

export const secretLeakCheck: Check = {
  id: "secret-leak",
  run({ target, server }: CheckInput): Finding[] {
    const findings: Finding[] = [];

    for (const location of configLocations(target)) {
      const prefixFindings = matchPrefix(location, server.id);
      findings.push(...prefixFindings);
      if (
        prefixFindings.length === 0 &&
        location.entropy &&
        location.value.length >= ENTROPY_MIN_LENGTH &&
        !isPlaceholder(location.value) &&
        shannonEntropy(location.value) >= ENTROPY_MIN
      ) {
        findings.push({
          checkId: "secret-leak",
          severity: "medium",
          serverId: server.id,
          title: `High-entropy value in ${location.where} (possible secret)`,
          detail:
            "This value looks random enough to be a credential. If it is, it should not live in the config.",
          evidence: `${location.where} = ${redact(location.value)}`,
          remediation: "If this is a secret, move it to a secret manager and rotate it.",
        });
      }
    }

    // Also scan capability descriptions for accidentally-embedded keys.
    const caps = [...server.tools, ...server.prompts, ...server.resources];
    for (const cap of caps) {
      if (!cap.description) continue;
      const prefixFindings = matchPrefix(
        { where: `${cap.kind} "${cap.name}" description`, value: cap.description, entropy: false },
        server.id,
      );
      for (const finding of prefixFindings) {
        findings.push({ ...finding, capability: { kind: cap.kind, name: cap.name } });
      }
    }

    return findings;
  },
};
