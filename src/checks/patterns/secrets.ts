import type { Severity } from "../types.js";

/**
 * Value-level secret detection, decoupled from where the value came from. The
 * same engine runs over MCP config values (env/headers/url/args), capability
 * descriptions, and tool *outputs* (--probe). High-confidence, provider-prefixed
 * shapes with conservative lengths to avoid matching short placeholders.
 */

interface SecretPattern {
  id: string;
  label: string;
  re: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // The negative lookahead keeps this from also matching Anthropic `sk-ant-` keys
  // (which would otherwise double-report under both labels).
  { id: "openai", label: "OpenAI API key", re: /sk-(?!ant-)(proj-)?[A-Za-z0-9_-]{20,}/ },
  { id: "anthropic", label: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: "stripe", label: "Stripe secret key", re: /[rs]k_(live|test)_[A-Za-z0-9]{20,}/ },
  { id: "github", label: "GitHub token", re: /gh[opsur]_[A-Za-z0-9]{36,}/ },
  { id: "github-pat", label: "GitHub fine-grained PAT", re: /github_pat_[A-Za-z0-9_]{60,}/ },
  { id: "slack", label: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: "aws", label: "AWS access key id", re: /(AKIA|ASIA)[0-9A-Z]{16}/ },
  { id: "google", label: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { id: "gcp-oauth", label: "Google OAuth client secret", re: /GOCSPX-[A-Za-z0-9_-]{20,}/ },
  { id: "gitlab", label: "GitLab PAT", re: /glpat-[A-Za-z0-9_-]{20,}/ },
  { id: "huggingface", label: "Hugging Face token", re: /\bhf_[A-Za-z0-9]{34,}/ },
  { id: "npm", label: "npm access token", re: /\bnpm_[A-Za-z0-9]{36}/ },
  { id: "sendgrid", label: "SendGrid API key", re: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/ },
  {
    id: "azure-conn",
    label: "Azure connection string key",
    re: /(AccountKey|SharedAccessKey)=[A-Za-z0-9+/]{20,}={0,2}/,
  },
  {
    id: "db-uri",
    label: "Database URI with embedded credentials",
    re: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^:\s/]+:[^@\s/]+@/i,
  },
  { id: "private-key", label: "Private key", re: /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/ },
  { id: "jwt", label: "JWT", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/ },
];

const ENTROPY_MIN = 4.0;
const ENTROPY_MIN_LENGTH = 24;

export function isPlaceholder(value: string): boolean {
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
export function redact(secret: string): string {
  const len = secret.length;
  if (len <= 8) return `${secret.slice(0, 2)}*** (${len} chars, redacted)`;
  return `${secret.slice(0, 4)}…${secret.slice(-2)} (${len} chars, redacted)`;
}

/** A single secret signal in one value. Presentation-neutral. */
export interface SecretHit {
  /** A pattern id, or "entropy". */
  id: string;
  label: string;
  severity: Severity;
  /** Caller-supplied location label (e.g. `env.API_KEY`, or `output`). */
  where: string;
  /** Pre-formatted, redacted evidence string including the `where` location. */
  evidence: string;
}

export interface SecretScanOptions {
  /** Run the high-entropy heuristic (only worth it in high-confidence spots like
   * env/headers — never on free-form prose or tool output). */
  entropy: boolean;
}

/**
 * Scan one value for secrets. A provider-prefixed match is `high`; a
 * high-entropy fallback (only when {@link SecretScanOptions.entropy}) is
 * `medium`. The entropy heuristic is skipped when a prefix already matched.
 */
export function scanValueForSecrets(
  value: string,
  where: string,
  options: SecretScanOptions,
): SecretHit[] {
  if (isPlaceholder(value)) return [];
  const hits: SecretHit[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const match = pattern.re.exec(value);
    if (match) {
      hits.push({
        id: pattern.id,
        label: pattern.label,
        severity: "high",
        where,
        evidence: `${where} = ${redact(match[0])}`,
      });
    }
  }
  if (
    hits.length === 0 &&
    options.entropy &&
    value.length >= ENTROPY_MIN_LENGTH &&
    shannonEntropy(value) >= ENTROPY_MIN
  ) {
    hits.push({
      id: "entropy",
      label: "High-entropy value",
      severity: "medium",
      where,
      evidence: `${where} = ${redact(value)}`,
    });
  }
  return hits;
}
