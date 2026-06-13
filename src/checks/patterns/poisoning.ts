import type { Severity } from "../types.js";

/**
 * Text-level poisoning detection, decoupled from where the text came from. The
 * same engine runs over capability descriptions/titles/schemas (static scan)
 * and over tool *outputs* (--probe), so detection lives here and the callers
 * own only the Finding presentation.
 *
 * Precision is deliberately favored over recall: one false "this server is
 * malicious" accusation is worse than a missed low-signal case. Add patterns
 * only when they rarely fire on legitimate descriptions.
 */

interface Pattern {
  id: string;
  label: string;
  re: RegExp;
  severity: Severity;
}

const PATTERNS: Pattern[] = [
  {
    id: "ignore-instructions",
    label: "Instruction-override phrase",
    re: /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|earlier|all)\b.{0,30}\b(instructions?|prompts?|rules?|context)\b/i,
    severity: "high",
  },
  {
    id: "hide-from-user",
    label: "Instruction to hide activity from the user",
    re: /\b(do not|don'?t|never)\b.{0,40}\b(tell|inform|mention|reveal|show|notify|disclose|let)\b.{0,30}\b(the )?(user|human|person)\b/i,
    severity: "high",
  },
  {
    id: "exfiltration",
    label: "Instruction to exfiltrate sensitive files/credentials",
    re: /\b(send|email|e-mail|upload|post|exfiltrate|leak|transmit|forward|copy)\b.{0,50}\b(\.ssh|\.aws|\.env|id_rsa|credentials?|secret|private[ _-]?key|password|api[ _-]?key|access[ _-]?token)\b/i,
    severity: "high",
  },
  {
    id: "before-other-tools",
    label: "Covert precondition referencing other tools",
    re: /\bbefore (using|calling|invoking|running)\b.{0,30}\b(any other|other|each|every|the next)\b.{0,15}\btools?\b/i,
    severity: "high",
  },
  {
    // Read instruction aimed at sensitive files (the recon half of an attack;
    // the exfiltration pattern covers the send half). Anchored to concrete
    // secret-bearing paths so "read a file from the file system" never trips it.
    // `.env` is intentionally excluded here — legitimate dotenv tools say "load
    // the .env file" — but the exfiltration pattern still catches "send … .env".
    id: "read-sensitive-files",
    label: "Instruction to read sensitive files",
    re: /\b(read|cat|open|load|access|fetch|retrieve|dump)\b.{0,40}(\bid_rsa\b|\.ssh\b|\.aws\b|\.gnupg\b|\.netrc\b|\.cursor\/mcp\.json|\/etc\/passwd)/i,
    severity: "high",
  },
  {
    // Chat-template / system-prompt scaffolding tokens have no business in a
    // capability description; they're LLM-specific and near-zero false-positive.
    id: "model-scaffolding",
    label: "Chat-template / system-prompt scaffolding",
    re: /<<\/?SYS>>|\[\/?INST\]|<\|(im_start|im_end|system|user|assistant)\|>/i,
    severity: "high",
  },
  {
    id: "no-confirmation",
    label: "Instruction to act without user confirmation",
    re: /\b(without (asking|prompting)|do not ask|don'?t ask|no need to ask)\b.{0,30}\b(the )?(user|permission|confirmation|approval|consent)\b/i,
    severity: "high",
  },
  {
    id: "decode-execute",
    label: "Instruction to decode and execute a payload",
    re: /\b(decode|base64|atob|unescape|fromcharcode)\b.{0,40}\b(and )?(run|execute|exec|eval|interpret)\b/i,
    severity: "high",
  },
  {
    id: "hidden-directive-tag",
    label: "Hidden directive tag (e.g. <IMPORTANT>)",
    re: /<\s*(important|secret|system|instructions?|admin)\s*>/i,
    severity: "medium",
  },
];

// Detected by code point to avoid embedding invisible characters in source.
// Zero-width space/non-joiner/joiner, word-joiner, BOM, and bidi controls
// (Trojan-Source style) that hide text from a human reviewer.
const HIDDEN_CODE_POINTS = new Set<number>([
  0x200b,
  0x200c,
  0x200d,
  0x2060,
  0xfeff, // zero-width / word-joiner / BOM
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e, // bidi embeddings/overrides
  0x2066,
  0x2067,
  0x2068,
  0x2069, // bidi isolates
]);

function hasHiddenUnicode(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code !== undefined && HIDDEN_CODE_POINTS.has(code)) return true;
  }
  return false;
}

const BASE64_BLOB = /[A-Za-z0-9+/]{60,}={0,2}/;

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 24);
  const core = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${core}${end < text.length ? "…" : ""}`;
}

/** A single poisoning signal in one piece of text. Presentation-neutral so both
 * the static check and the output-inspection check can build their own Findings. */
export interface PoisonHit {
  /** Stable id: a pattern id, or "hidden-unicode" / "encoded-blob". */
  id: string;
  /** Human label, used verbatim in finding titles. */
  label: string;
  severity: Severity;
  /** Pre-formatted evidence string, already including the `where` location. */
  evidence: string;
}

/**
 * Scan one string for every poisoning signal. `where` is a caller-supplied
 * location label (a JSON path, or "output") folded into each hit's evidence.
 */
export function scanTextForPoisoning(text: string, where: string): PoisonHit[] {
  const hits: PoisonHit[] = [];
  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(text);
    if (match) {
      hits.push({
        id: pattern.id,
        label: pattern.label,
        severity: pattern.severity,
        evidence: `${where}: ${snippet(text, match.index, match[0].length)}`,
      });
    }
  }
  if (hasHiddenUnicode(text)) {
    hits.push({
      id: "hidden-unicode",
      label: "Hidden/invisible unicode",
      severity: "high",
      evidence: `${where} contains hidden control characters`,
    });
  }
  const blob = BASE64_BLOB.exec(text);
  if (blob) {
    hits.push({
      id: "encoded-blob",
      label: "Encoded blob",
      severity: "low",
      evidence: `${where}: ${snippet(text, blob.index, Math.min(blob[0].length, 24))}`,
    });
  }
  return hits;
}
