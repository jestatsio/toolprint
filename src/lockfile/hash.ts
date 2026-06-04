import { createHash } from "node:crypto";
import { OperationalError } from "../errors.js";
import { MAX_JSON_DEPTH } from "../limits.js";

/**
 * Canonical, deterministic serialization of a JSON-compatible value.
 *
 * Stability is correctness-critical: a hash that flips on cosmetic
 * re-serialization trains users to ignore drift alerts (cry-wolf). Rules:
 *   - object keys sorted recursively
 *   - all strings normalized to Unicode NFC
 *   - array order preserved (order is semantically meaningful in JSON Schema,
 *     e.g. `enum`, `prefixItems`)
 *   - no insignificant whitespace (JSON.stringify default)
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown, depth = 0): unknown {
  if (depth > MAX_JSON_DEPTH) {
    throw new OperationalError(
      `Definition nested deeper than ${MAX_JSON_DEPTH} levels — refusing to hash a pathological response.`,
    );
  }
  if (typeof value === "string") return value.normalize("NFC");
  // null, number, boolean, undefined pass through (matches JSON.stringify).
  if (value === null || typeof value !== "object") return value;
  // NB: wrap the recursion — Array.map would otherwise pass the index as `depth`.
  if (Array.isArray(value)) return value.map((item) => normalize(item, depth + 1));

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const normalizedValue = normalize(obj[key], depth + 1);
    // Drop undefined-valued keys so a missing field and an explicit `undefined`
    // hash identically (JSON.stringify drops them too).
    if (normalizedValue === undefined) continue;
    out[key.normalize("NFC")] = normalizedValue;
  }
  return out;
}

/** Top-level fields that are transport/runtime metadata, not part of the
 * security-relevant tool contract. Stripped before hashing. */
const VOLATILE_FIELDS = new Set(["_meta"]);

/**
 * Hash the security-relevant contract of a capability. We hash the *entire*
 * object (minus volatile fields) so any change — name, description, input or
 * output schema, title, annotations — is caught, not just the description.
 *
 * @returns a string like `sha256:ab12...`
 */
export function hashCapability(raw: Record<string, unknown>): string {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (VOLATILE_FIELDS.has(key)) continue;
    stripped[key] = value;
  }
  const digest = createHash("sha256").update(canonicalize(stripped)).digest("hex");
  return `sha256:${digest}`;
}
