import type { Capability, CapabilityKind } from "../model.js";
import type { Check, CheckInput, Finding, Severity } from "./types.js";

interface Pattern {
  id: string;
  label: string;
  re: RegExp;
  severity: Severity;
}

/**
 * Conservative, high-precision patterns for instructions aimed at the *model*
 * hidden inside a tool/prompt description or schema. Precision is deliberately
 * favored over recall: one false "this server is malicious" accusation is worse
 * than a missed low-signal case. Add patterns only when they rarely fire on
 * legitimate descriptions.
 */
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

/** Pull every human-readable string (description/title) out of a JSON schema. */
function collectSchemaText(schema: unknown, acc: string[]): void {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    for (const item of schema) collectSchemaText(item, acc);
    return;
  }
  const obj = schema as Record<string, unknown>;
  if (typeof obj.description === "string") acc.push(obj.description);
  if (typeof obj.title === "string") acc.push(obj.title);
  for (const value of Object.values(obj)) collectSchemaText(value, acc);
}

interface TextSource {
  where: string;
  text: string;
}

function textSources(capability: Capability): TextSource[] {
  const sources: TextSource[] = [];
  if (capability.description) sources.push({ where: "description", text: capability.description });
  const schemaText: string[] = [];
  collectSchemaText(capability.raw.inputSchema, schemaText);
  collectSchemaText(capability.raw.outputSchema, schemaText);
  schemaText.forEach((text, i) => sources.push({ where: `schema description #${i + 1}`, text }));
  return sources;
}

function inspect(capability: Capability, kind: CapabilityKind, serverId: string): Finding[] {
  const findings: Finding[] = [];
  for (const source of textSources(capability)) {
    for (const pattern of PATTERNS) {
      const match = pattern.re.exec(source.text);
      if (match) {
        findings.push({
          checkId: "tool-poisoning",
          severity: pattern.severity,
          serverId,
          capability: { kind, name: capability.name },
          title: `${pattern.label} in ${kind} "${capability.name}"`,
          detail:
            "This text is read by the model when it decides whether and how to call the tool. " +
            "Embedded instructions can hijack an agent (prompt injection / tool poisoning).",
          evidence: `${source.where}: ${snippet(source.text, match.index, match[0].length)}`,
          remediation:
            "Confirm this wording is intentional and benign; if not, stop using this server.",
        });
      }
    }
    if (hasHiddenUnicode(source.text)) {
      findings.push({
        checkId: "tool-poisoning",
        severity: "high",
        serverId,
        capability: { kind, name: capability.name },
        title: `Hidden/invisible unicode in ${kind} "${capability.name}"`,
        detail:
          "The description contains zero-width or bidirectional-control characters, which can hide " +
          "instructions from a human reviewer while the model still reads them.",
        evidence: `${source.where} contains hidden control characters`,
        remediation: "Treat as malicious unless you can explain the hidden characters.",
      });
    }
    const blob = BASE64_BLOB.exec(source.text);
    if (blob) {
      findings.push({
        checkId: "tool-poisoning",
        severity: "low",
        serverId,
        capability: { kind, name: capability.name },
        title: `Encoded blob in ${kind} "${capability.name}"`,
        detail:
          "A long base64-like run in a description is unusual and can carry a hidden payload.",
        evidence: `${source.where}: ${snippet(source.text, blob.index, Math.min(blob[0].length, 24))}`,
        remediation: "Decode and verify the blob is benign.",
      });
    }
  }
  return findings;
}

export const toolPoisoningCheck: Check = {
  id: "tool-poisoning",
  run({ server }: CheckInput): Finding[] {
    const findings: Finding[] = [];
    for (const tool of server.tools) findings.push(...inspect(tool, "tool", server.id));
    for (const prompt of server.prompts) findings.push(...inspect(prompt, "prompt", server.id));
    return findings;
  },
};
