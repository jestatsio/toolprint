import { OperationalError } from "../errors.js";
import type { ServerTarget } from "../model.js";

/**
 * Runtime authentication for http(s)/sse targets.
 *
 * Auth headers come from CLI flags (`--header`, `--bearer`) and the environment
 * (`TOOLPRINT_BEARER`, `TOOLPRINT_HEADER_*`). They are kept *separate* from the
 * declarative `headers` a config file carries: config headers may be committed
 * to a repo (and so are scanned for leaked secrets), whereas these are supplied
 * at run time on purpose — they are never scanned and never written to the
 * lockfile. See {@link applyAuthHeaders}.
 */

const ENV_BEARER = "TOOLPRINT_BEARER";
const ENV_HEADER_PREFIX = "TOOLPRINT_HEADER_";

/** RFC 7230 header field-name grammar (a `token`). Rejects spaces, control
 * chars, and CR/LF — the latter being the header-injection vector. */
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** CR, LF, and NUL are the header-injection vectors in a *value*. The runtime's
 * fetch/undici rejects these too, but we enforce it ourselves so the security
 * boundary is explicit and not dependent on the HTTP client. */
const HEADER_VALUE_FORBIDDEN_RE = /[\r\n\0]/;

function assertSafeHeaderValue(value: string, source: string): void {
  if (HEADER_VALUE_FORBIDDEN_RE.test(value)) {
    throw new OperationalError(`Invalid ${source}: value contains a CR, LF, or NUL character.`);
  }
}

export interface AuthCliOptions {
  /** Repeated `--header "Name: Value"` values. */
  header?: string[];
  /** `--bearer <token>` shorthand for an `Authorization: Bearer` header. */
  bearer?: string;
}

function authorizationFromBearer(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

/**
 * Set `name: value`, removing any existing header that matches case-insensitively
 * first. HTTP header names are case-insensitive, so this keeps a single entry per
 * logical header (the last writer's name and value win) — preventing a duplicate
 * `Authorization` when, say, `--bearer` follows a config `authorization`.
 */
function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const lower = name.toLowerCase();
  for (const existing of Object.keys(headers)) {
    if (existing.toLowerCase() === lower) delete headers[existing];
  }
  headers[name] = value;
}

/**
 * Parse a `--header` argument of the form `"Name: Value"`. Splits on the first
 * colon only, so the value may itself contain colons (e.g. a URL). Validates the
 * name against the HTTP token grammar and rejects empty/unsafe values.
 *
 * Error messages deliberately never echo the raw argument or the value — a user
 * who forgets the colon and passes a bare token (`--header "ghp_…"`) must not
 * have it printed to stderr.
 */
export function parseHeaderArg(raw: string): [name: string, value: string] {
  const idx = raw.indexOf(":");
  if (idx === -1) {
    throw new OperationalError(
      'Invalid --header: expected "Name: Value" (missing ":"). ' +
        "Pass a secret via TOOLPRINT_BEARER / TOOLPRINT_HEADER_<NAME> to keep it off the command line.",
    );
  }
  const name = raw.slice(0, idx).trim();
  const value = raw.slice(idx + 1).trim();
  if (!name)
    throw new OperationalError('Invalid --header: empty header name (expected "Name: Value").');
  if (!HEADER_NAME_RE.test(name)) {
    throw new OperationalError(`Invalid --header name "${name}": not a valid HTTP header name.`);
  }
  if (!value) throw new OperationalError(`Invalid --header: empty value for "${name}".`);
  assertSafeHeaderValue(value, `--header "${name}"`);
  return [name, value];
}

/** `TOOLPRINT_HEADER_X_API_KEY` → `X-API-KEY` (underscores become hyphens, case
 * preserved). For an exact mixed-case name, use `--header`. */
function envSuffixToHeaderName(suffix: string): string {
  return suffix.replace(/_/g, "-");
}

/**
 * Build the runtime auth headers from the environment, then CLI flags. Precedence
 * is lowest-to-highest (last write wins, compared case-insensitively):
 * `TOOLPRINT_BEARER` → `TOOLPRINT_HEADER_*` → `--bearer` → `--header`. Returns
 * `undefined` when nothing is configured.
 */
export function collectAuthHeaders(
  options: AuthCliOptions,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};

  const envBearer = env[ENV_BEARER]?.trim();
  if (envBearer) {
    assertSafeHeaderValue(envBearer, ENV_BEARER);
    setHeader(headers, ...authorizationFromBearer(envBearer));
  }

  for (const [key, raw] of Object.entries(env)) {
    if (!key.startsWith(ENV_HEADER_PREFIX) || raw === undefined) continue;
    const value = raw.trim();
    if (!value) continue; // ignore blank env header values, like TOOLPRINT_BEARER
    const name = envSuffixToHeaderName(key.slice(ENV_HEADER_PREFIX.length));
    if (!name) continue;
    if (!HEADER_NAME_RE.test(name)) {
      throw new OperationalError(
        `Invalid header name from ${key}: "${name}" is not a valid HTTP header name.`,
      );
    }
    assertSafeHeaderValue(value, key);
    setHeader(headers, name, value);
  }

  const cliBearer = options.bearer?.trim();
  if (cliBearer) {
    assertSafeHeaderValue(cliBearer, "--bearer");
    setHeader(headers, ...authorizationFromBearer(cliBearer));
  }

  for (const raw of options.header ?? []) {
    setHeader(headers, ...parseHeaderArg(raw));
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Merge `override` onto `base`, case-insensitively: an override replaces a base
 * header of the same name regardless of casing, so the wire never carries two
 * copies of one header. Returns `undefined` when the result is empty.
 */
export function mergeHeaders(
  base: Record<string, string> | undefined,
  override: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!base && !override) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(base ?? {})) setHeader(out, name, value);
  for (const [name, value] of Object.entries(override ?? {})) setHeader(out, name, value);
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Attach runtime auth headers to every http/sse target, immutably. stdio targets
 * are returned untouched (headers are meaningless there). When no auth is
 * configured, the original list is returned as-is.
 */
export function applyAuthHeaders(
  targets: ServerTarget[],
  authHeaders: Record<string, string> | undefined,
): ServerTarget[] {
  if (!authHeaders) return targets;
  // Give each target its own copy so nothing downstream can mutate the shared map.
  return targets.map((target) =>
    target.transport === "stdio" ? target : { ...target, authHeaders: { ...authHeaders } },
  );
}
