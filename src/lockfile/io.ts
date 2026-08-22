import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse as parsePath, relative } from "node:path";
import { OperationalError } from "../errors.js";
import { MAX_JSON_DEPTH } from "../limits.js";
import type { Capability, ServerCapabilities } from "../model.js";
import { TOOLPRINT_VERSION } from "../version.js";
import { hashCapability } from "./hash.js";
import {
  LOCKFILE_NAME,
  LOCKFILE_VERSION,
  type LockedCapability,
  type LockedServer,
  type Lockfile,
  LockfileSchema,
} from "./schema.js";

export { LOCKFILE_NAME };

/** Walk up from `startDir` looking for an existing toolprint.lock. */
export function findLockfile(startDir: string): string | null {
  let dir = startDir;
  const { root } = parsePath(dir);
  for (;;) {
    const candidate = join(dir, LOCKFILE_NAME);
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

/** Where the lockfile is (or should be): explicit path wins, then an existing
 * one up-tree, else default to the cwd. */
export function resolveLockfilePath(cwd: string, explicit?: string): string {
  if (explicit) return explicit;
  return findLockfile(cwd) ?? join(cwd, LOCKFILE_NAME);
}

/** Human/JSON-friendly lock path: relative when it sits under cwd, else absolute
 * (a `../../../..` relative path to an out-of-tree lock reads worse than the path). */
export function displayLockPath(cwd: string, lockPath: string): string {
  const rel = relative(cwd, lockPath);
  return rel && !rel.startsWith("..") ? rel : lockPath;
}

/** Read + validate a lockfile. Returns null if it doesn't exist. */
export function readLockfile(path: string): Lockfile | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new OperationalError(`Lockfile at ${path} is not valid JSON`, error);
  }
  const result = LockfileSchema.safeParse(parsed);
  if (!result.success) {
    throw new OperationalError(
      `Lockfile at ${path} is malformed: ${result.error.issues.map((i) => i.message).join("; ")}`,
      result.error,
    );
  }
  return result.data;
}

function toLockedCapability(capability: Capability): LockedCapability {
  const locked: LockedCapability = { hash: hashCapability(capability.raw) };
  if (capability.description !== undefined) locked.description = capability.description;
  return locked;
}

function toLockedRecord(capabilities: Capability[]): Record<string, LockedCapability> {
  const out: Record<string, LockedCapability> = {};
  for (const capability of capabilities) out[capability.name] = toLockedCapability(capability);
  return out;
}

export function toLockedServer(server: ServerCapabilities): LockedServer {
  return {
    transport: server.transport,
    source: server.source,
    tools: toLockedRecord(server.tools),
    prompts: toLockedRecord(server.prompts),
    resources: toLockedRecord(server.resources),
    resourceTemplates: toLockedRecord(server.resourceTemplates),
    skills: toLockedRecord(server.skills),
  };
}

/**
 * Produce the next lockfile by overlaying freshly-scanned servers onto any
 * existing one. Servers not scanned this run are preserved untouched.
 */
export function mergeLockfile(
  existing: Lockfile | null,
  scanned: ServerCapabilities[],
  now: string,
): Lockfile {
  const servers: Record<string, LockedServer> = { ...(existing?.servers ?? {}) };
  for (const server of scanned) servers[server.id] = toLockedServer(server);
  return {
    lockfileVersion: LOCKFILE_VERSION,
    toolprintVersion: TOOLPRINT_VERSION,
    generatedAt: now,
    servers,
  };
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) out[key] = record[key] as T;
  return out;
}

/** Servers in a stable order (sorted ids + capability keys) — the comparable
 * core of a lockfile, independent of volatile metadata. */
function orderServers(servers: Record<string, LockedServer>): Record<string, LockedServer> {
  const out: Record<string, LockedServer> = {};
  for (const id of Object.keys(servers).sort()) {
    const server = servers[id] as LockedServer;
    out[id] = {
      transport: server.transport,
      source: server.source,
      tools: sortRecord(server.tools),
      prompts: sortRecord(server.prompts),
      resources: sortRecord(server.resources),
      resourceTemplates: sortRecord(server.resourceTemplates),
      skills: sortRecord(server.skills),
    };
  }
  return out;
}

/** Deterministic, diff-friendly serialization: sorted server + capability keys. */
export function serializeLockfile(lockfile: Lockfile): string {
  const ordered: Lockfile = {
    lockfileVersion: lockfile.lockfileVersion,
    toolprintVersion: lockfile.toolprintVersion,
    generatedAt: lockfile.generatedAt,
    servers: orderServers(lockfile.servers),
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}

/**
 * True when two lockfiles pin identical content, ignoring volatile metadata
 * (`generatedAt`, `toolprintVersion`). Lets `--update` skip a no-op write so
 * re-running pin never churns the committed lockfile's timestamp.
 */
export function lockedContentEquals(a: Lockfile, b: Lockfile): boolean {
  return contentKey(a) === contentKey(b);
}

function contentKey(lockfile: Lockfile): string {
  // Order-independent: every object key is sorted recursively, so equality
  // depends only on values — never on field or scan order (a disk-read lock and
  // a freshly-merged one compare equal when their content matches).
  return stableStringify({
    lockfileVersion: lockfile.lockfileVersion,
    servers: lockfile.servers,
  });
}

function stableStringify(value: unknown, depth = 0): string {
  if (depth > MAX_JSON_DEPTH) {
    throw new OperationalError(
      `Lockfile content nested deeper than ${MAX_JSON_DEPTH} levels — refusing to process a pathological structure.`,
    );
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  // NB: wrap the recursion — Array.map would otherwise pass the index as `depth`.
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item, depth + 1)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key], depth + 1)}`);
  return `{${entries.join(",")}}`;
}

export function writeLockfile(path: string, lockfile: Lockfile): void {
  writeFileSync(path, serializeLockfile(lockfile), "utf8");
}
