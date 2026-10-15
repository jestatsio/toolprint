// Build the three distributable plugin packages for a GitHub Release:
//
//   toolprint-<v>.mcpb             Claude Desktop bundle (dist + production
//                                   node_modules included; Desktop supplies Node)
//   toolprint-<v>-claude-code.zip  Claude Code plugin (npx-pinned, no build needed)
//   toolprint-<v>-codex.zip        Codex plugin (npx-pinned, no build needed)
//   toolprint-<v>-marketplace.zip  Codex local marketplace root wrapping the plugin
//
// The Claude Code and Codex zips are convenience copies of what the in-repo
// marketplaces already serve from git; the .mcpb is the only package that
// must bundle code, because Claude Desktop cannot fetch from npm itself.
//
// Usage: npm run package:plugins   (runs the build first via package.json)
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const outDir = join(root, "release-dist");
const stageRoot = join(outDir, ".stage");

function run(command, cwd = root) {
  execSync(command, { cwd, stdio: "inherit" });
}

function copyInto(stage, relPaths) {
  for (const rel of relPaths) {
    const from = join(root, rel);
    if (!existsSync(from)) throw new Error(`package-plugins: missing ${rel}`);
    cpSync(from, join(stage, rel), { recursive: true });
  }
}

function zipDir(stage, zipName) {
  const zipPath = join(outDir, zipName);
  rmSync(zipPath, { force: true });
  run(`zip -qr -X "${zipPath}" .`, stage);
  const sha256 = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
  console.log(`${zipName}\n  sha256 ${sha256}`);
  return { file: zipName, sha256 };
}

if (!existsSync(join(root, "dist/cli.js"))) {
  throw new Error("package-plugins: dist/cli.js not found — run `npm run build` first");
}

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stageRoot, { recursive: true });

const results = {};

// --- Claude Desktop .mcpb -------------------------------------------------
{
  const stage = join(stageRoot, "mcpb");
  mkdirSync(stage, { recursive: true });
  copyInto(stage, ["manifest.json", "dist", "assets/mascot.png", "LICENSE", "README.md"]);
  // A minimal package.json so the staged production install resolves exactly
  // the runtime dependencies (and nothing from devDependencies).
  writeFileSync(
    join(stage, "package.json"),
    JSON.stringify(
      {
        name: pkg.name,
        version,
        private: true,
        type: pkg.type,
        dependencies: pkg.dependencies,
      },
      null,
      2,
    ) + "\n",
  );
  run("npm install --omit=dev --ignore-scripts --no-audit --no-fund", stage);
  rmSync(join(stage, "package-lock.json"), { force: true });
  results.mcpb = zipDir(stage, `toolprint-${version}.mcpb`);
}

// --- Claude Code plugin zip ------------------------------------------------
{
  const stage = join(stageRoot, "claude-code/toolprint");
  mkdirSync(stage, { recursive: true });
  copyInto(stage, [
    ".claude-plugin/plugin.json",
    ".mcp.json",
    "skills",
    "commands",
    "assets/icon.svg",
    "assets/mascot.png",
    "LICENSE",
    "README.md",
  ]);
  results.claudeCode = zipDir(
    join(stageRoot, "claude-code"),
    `toolprint-${version}-claude-code.zip`,
  );
}

// --- Codex plugin zip --------------------------------------------------------
{
  const stage = join(stageRoot, "codex/toolprint");
  mkdirSync(stage, { recursive: true });
  copyInto(stage, [
    ".codex-plugin/plugin.json",
    "plugin.json",
    ".mcp.json",
    "skills",
    "assets/icon.svg",
    "assets/mascot.png",
    "LICENSE",
    "README.md",
  ]);
  results.codex = zipDir(join(stageRoot, "codex"), `toolprint-${version}-codex.zip`);
}

// --- Codex local marketplace zip --------------------------------------------
// The marketplace entry points at "./", so this zip's root is both the
// marketplace root and the plugin root.
{
  const stage = join(stageRoot, "marketplace");
  mkdirSync(stage, { recursive: true });
  copyInto(stage, [
    ".agents/plugins/marketplace.json",
    ".codex-plugin/plugin.json",
    "plugin.json",
    ".mcp.json",
    "skills",
    "assets/icon.svg",
    "assets/mascot.png",
    "LICENSE",
    "README.md",
  ]);
  results.marketplace = zipDir(stage, `toolprint-${version}-marketplace.zip`);
}

writeFileSync(
  join(outDir, "checksums.json"),
  JSON.stringify({ version, ...results }, null, 2) + "\n",
);
rmSync(stageRoot, { recursive: true, force: true });
console.log(`\nPackages written to release-dist/ (see checksums.json)`);
