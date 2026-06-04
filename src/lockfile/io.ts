import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import { OperationalError } from "../errors.js";
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

/** Deterministic, diff-friendly serialization: sorted server + capability keys. */
export function serializeLockfile(lockfile: Lockfile): string {
  const servers: Record<string, LockedServer> = {};
  for (const id of Object.keys(lockfile.servers).sort()) {
    const server = lockfile.servers[id] as LockedServer;
    servers[id] = {
      transport: server.transport,
      source: server.source,
      tools: sortRecord(server.tools),
      prompts: sortRecord(server.prompts),
      resources: sortRecord(server.resources),
    };
  }
  const ordered: Lockfile = {
    lockfileVersion: lockfile.lockfileVersion,
    toolprintVersion: lockfile.toolprintVersion,
    generatedAt: lockfile.generatedAt,
    servers,
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}

export function writeLockfile(path: string, lockfile: Lockfile): void {
  writeFileSync(path, serializeLockfile(lockfile), "utf8");
}
