# Distribution

Where toolprint 0.4.1 is published, and the honest status of each directory. Machine-readable
checksums live in [distribution.json](https://github.com/jestatsio/toolprint/blob/main/docs/distribution.json);
build the packages yourself with `npm run package:plugins`.

## Published by this repository

| Channel        | How users install                                                                               | Status                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| npm            | `npx toolprint@0.4.1`                                                                           | Published by the `Publish to npm` workflow (OIDC trusted publishing) on each GitHub Release                                          |
| Claude Desktop | Download `toolprint-0.4.1.mcpb` from the release, open it, confirm Install                      | Release asset; directory listing is not offered for local bundles (Anthropic deprecated MCPB directory listings in favor of plugins) |
| Claude Code    | `/plugin install toolprint --marketplace jestatsio/toolprint`                                   | In-repository marketplace (`.claude-plugin/marketplace.json`, source `./`); no submission or review involved                         |
| Codex          | `codex plugin marketplace add jestatsio/toolprint`, then `codex plugin add toolprint@toolprint` | In-repository marketplace (`.agents/plugins/marketplace.json`)                                                                       |
| MCP Registry   | Any client that reads registry.modelcontextprotocol.io                                          | `io.github.jestatsio/toolprint`, published automatically after npm by `.github/workflows/mcp-registry.yml` (GitHub OIDC)             |
| GitHub Action  | `jestatsio/toolprint@v1`                                                                        | Unchanged since 0.3.x                                                                                                                |

The marketplace installs and the MCP Registry entry were exercised end to end during the
0.4.x work: `claude plugin validate --strict` passes, an isolated Claude Code config
installed `toolprint@toolprint` (skill, commands, and MCP server all inventoried), and an
isolated Codex home added the marketplace and installed the plugin enabled. The
extracted `.mcpb` bundle served both tools over stdio and scanned the clean fixture.

**Claude directory: submitted October 15, 2026.** The 0.4.0 validation flagged
credential-shaped literals in the detection-test fixtures; those are now assembled from
fragments (no literal ships), validation passes, and the submission is in the security
scan queue, then human review of the pinned-`npx` policy holds. Updates track `main`.

**OpenAI plugin directory: draft uploaded, local-MCP allowlist outstanding.** The portal
draft passes skill checks; the remaining findings were metadata (subtitle length, support /
privacy / terms URLs — fixed in 0.4.1 with [Privacy policy](privacy.md) and
[Terms](terms.md) pages) and the structural one: the public directory only "connects"
remote MCP servers in this flow. A local (stdio) MCP plugin follows the
[desktop-only path](https://developers.openai.com/plugins/deploy/desktop-only), which
requires the submitting organization to be allowlisted first: send the organization ID
(from OpenAI Platform organization settings) to an OpenAI representative and wait for
confirmation. The bundled `toolprint-<version>-codex-directory.zip` release asset is built
for that path (root `mcp.json`, server and dependencies inside the package). As of the 0.4.1
upload the draft's only remaining finding is exactly that gate, quoted by the portal:
"Command MCP Server detected: We recommend using MCP servers with an URL. Please contact
your OpenAI representative to submit plugins with command line MCPs." The MCP itself is
registered correctly (toolprint · node · stdio · Desktop only), so once the organization is
allowlisted the draft can be submitted as-is.

## Official directories (manual portals)

Neither official directory accepts a programmatic submission for a plugin like this one.
What is prepared here, and what a maintainer still has to do in a browser:

### Anthropic plugin directory

- Portal: [claude.ai/directory/manage](https://claude.ai/directory/manage) → Submit new →
  Plugin bundle. Requires a paid Claude plan (Pro, Max, Team, or Enterprise).
- Point it at `jestatsio/toolprint`, branch `main`. The package already satisfies the
  published checklist items we can control: `claude plugin validate --strict` passes, the
  README carries the one-step marketplace install line, a LICENSE is present, and the
  `.mcp.json` launcher is pinned to an exact version (`toolprint@0.4.1`). A pinned `npx`
  launcher is held for human review by policy — expect that step.
- After approval, updates track pushes to `main`; the version pin in `.mcp.json` must be
  bumped per release (the packaging test fails when it drifts from `package.json`).

### OpenAI plugin directory

- Portal: [platform.openai.com/plugins](https://platform.openai.com/plugins) → Upload new or
  existing plugin. Requires organization-owner rights (or Apps Management Write) and
  completed individual or business verification.
- Upload `toolprint-0.4.1-codex.zip` from the release; listing fields prefill from
  `.codex-plugin/plugin.json` (display name, descriptions, category, logo, brand color).
- Local MCP submissions are limited to approved partners: the submitting organization must
  be allowlisted first. Until that happens, the supported Codex route is the in-repository
  marketplace above — which is a full install path, not a preview.

## Release procedure

1. Bump `package.json` and `src/version.ts` together (a test enforces this), update
   `CHANGELOG.md`, and let the packaging test pull the new version through every manifest —
   it fails until `plugin.json` (×3), `manifest.json`, `server.json`, the Claude marketplace
   entry, and the pinned `.mcp.json` argument all match.
2. `npm run package:plugins`, then create the GitHub Release `vX.Y.Z` with the four files
   from `release-dist/` attached.
3. The release triggers npm publishing (OIDC), which in turn triggers the MCP Registry
   workflow.
4. Replace the checksums and status in `distribution.json` with the published assets'
   values, in a follow-up commit like the other JEStats plugins do.
5. For directory listings tracked in the portals, push to `main` (Anthropic) or upload the
   new Codex zip (OpenAI, once allowlisted).
