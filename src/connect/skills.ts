import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { OperationalError } from "../errors.js";
import type { Capability, ServerCapabilities, ServerTarget } from "../model.js";

/**
 * Read Agent Skills (https://agentskills.io) `SKILL.md` bundles from disk.
 *
 * A skill bundle is text an agent reads and then follows — exactly the trust
 * surface of an MCP tool description, and exactly as rewritable after you have
 * come to trust it. Modelling a skills directory as a capability source lets the
 * existing poisoning, secret-leak, and rug-pull checks apply unchanged, so a
 * marketplace skill that is silently edited shows up as a lockfile diff.
 *
 * The whole file (frontmatter *and* body) is hashed, because the body is the
 * instruction payload — a rug-pull that only touches the body must still be
 * caught.
 */

/** Directory depth we descend looking for `SKILL.md`. Bundles live at
 * `<root>/<skill>/SKILL.md`; plugin layouts add one more level. */
const MAX_DEPTH = 3;

/** Guards against pointing `--skills` at a home directory by mistake. */
const MAX_BUNDLES = 2000;

export interface SkillBundle {
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Skill name: the `name:` frontmatter field, else the containing directory. */
  name: string;
  description?: string;
  frontmatter: string;
  body: string;
}

/**
 * Split `---`-delimited YAML frontmatter from the body. Returns the raw
 * frontmatter text; no YAML parser is pulled in, because the only fields read
 * for display are simple scalars and the *hash* covers the raw text regardless.
 */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { frontmatter: "", body: normalized };
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: "", body: normalized };
  return {
    frontmatter: normalized.slice(4, end + 1),
    body: normalized.slice(end + 4).replace(/^\n/, ""),
  };
}

/** Read one top-level scalar out of frontmatter, unquoting if needed. */
export function frontmatterField(frontmatter: string, field: string): string | undefined {
  for (const line of frontmatter.split("\n")) {
    // Top-level keys only: an indented line belongs to a nested structure.
    if (/^\s/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match || match[1] !== field) continue;
    const value = (match[2] ?? "").trim();
    if (value === "") return undefined;
    const unquoted = value.replace(/^(['"])([\s\S]*)\1$/, "$2");
    return unquoted.trim() || undefined;
  }
  return undefined;
}

function findSkillFiles(root: string, depth = 0, acc: string[] = []): string[] {
  if (depth > MAX_DEPTH || acc.length >= MAX_BUNDLES) return acc;

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return acc; // unreadable directory — skip rather than fail the whole scan
  }

  if (entries.includes("SKILL.md")) acc.push(join(root, "SKILL.md"));

  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const child = join(root, entry);
    let isDir = false;
    try {
      isDir = statSync(child).isDirectory();
    } catch {
      continue;
    }
    if (isDir) findSkillFiles(child, depth + 1, acc);
  }
  return acc;
}

/** Every `SKILL.md` bundle under `root`, sorted by path for stable output. */
export function readSkillBundles(root: string): SkillBundle[] {
  const absolute = resolve(root);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new OperationalError(`Skills directory not found: ${root}`);
  }

  return findSkillFiles(absolute)
    .sort()
    .map((path) => {
      const content = readFileSync(path, "utf8");
      const { frontmatter, body } = splitFrontmatter(content);
      const bundle: SkillBundle = {
        path,
        name: frontmatterField(frontmatter, "name") ?? basename(join(path, "..")),
        frontmatter,
        body,
      };
      const description = frontmatterField(frontmatter, "description");
      if (description) bundle.description = description;
      return bundle;
    });
}

/**
 * Turn a bundle into a {@link Capability}. The body is carried as
 * `instructions`, one of the field names the poisoning check treats as
 * agent-read text — so an injected instruction in the body is flagged the same
 * way one in a tool description is.
 */
export function bundleToCapability(bundle: SkillBundle, root: string): Capability {
  const relative = bundle.path.startsWith(root) ? bundle.path.slice(root.length + 1) : bundle.path;
  const capability: Capability = {
    kind: "skill",
    name: bundle.name,
    raw: {
      name: bundle.name,
      path: relative,
      ...(bundle.description ? { description: bundle.description } : {}),
      frontmatter: bundle.frontmatter,
      instructions: bundle.body,
    },
  };
  if (bundle.description) capability.description = bundle.description;
  return capability;
}

/** Expand a `~`-prefixed path; other paths resolve against the working directory. */
function expandRoot(source: string): string {
  if (source === "~") return homedir();
  if (source.startsWith("~/")) return join(homedir(), source.slice(2));
  return resolve(source);
}

/** Read a skills-directory target into the same shape an MCP server produces. */
export function readSkillsSource(target: ServerTarget): ServerCapabilities {
  const root = expandRoot(target.source);
  const bundles = readSkillBundles(root);
  return {
    id: target.id,
    transport: "skills",
    source: target.source,
    tools: [],
    prompts: [],
    resources: [],
    resourceTemplates: [],
    skills: bundles.map((bundle) => bundleToCapability(bundle, root)),
  };
}
