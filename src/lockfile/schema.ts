import { z } from "zod";

export const LOCKFILE_NAME = "toolprint.lock";
export const LOCKFILE_VERSION = 1;

/** One pinned capability: the hash is the trust anchor; the raw description is
 * stored so drift can be shown as a human diff without re-contacting the server. */
export const LockedCapabilitySchema = z.object({
  hash: z.string(),
  description: z.string().optional(),
});
export type LockedCapability = z.infer<typeof LockedCapabilitySchema>;

export const LockedServerSchema = z.object({
  transport: z.string(),
  source: z.string().optional(),
  tools: z.record(z.string(), LockedCapabilitySchema).default({}),
  prompts: z.record(z.string(), LockedCapabilitySchema).default({}),
  resources: z.record(z.string(), LockedCapabilitySchema).default({}),
  // Added in a later toolprint; `.default({})` keeps older lockfiles valid.
  resourceTemplates: z.record(z.string(), LockedCapabilitySchema).default({}),
});
export type LockedServer = z.infer<typeof LockedServerSchema>;

export const LockfileSchema = z.object({
  lockfileVersion: z.number().int(),
  toolprintVersion: z.string(),
  generatedAt: z.string(),
  servers: z.record(z.string(), LockedServerSchema).default({}),
});
export type Lockfile = z.infer<typeof LockfileSchema>;
