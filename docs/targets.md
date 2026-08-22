# Targets

What you can point `toolprint scan` at.

## A config file

```bash
npx toolprint scan ./.vscode/mcp.json
npx toolprint scan --config ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Every server in the file becomes a target. toolprint understands the shapes real clients use:

| Key               | Client                                                                 |
| ----------------- | ---------------------------------------------------------------------- |
| `mcpServers`      | Claude Desktop, Claude Code, Cursor, Windsurf, Gemini CLI, IBM Bob, Pi |
| `servers`         | VS Code                                                                |
| `mcp.servers`     | VS Code `settings.json`                                                |
| `context_servers` | Zed                                                                    |
| `amp.mcpServers`  | Amp                                                                    |
| `mcp`             | OpenCode (array `command`, `environment` for env)                      |

An entry marked `"enabled": false` is reported as skipped, not scanned — it is not in your agent's
hands.

### Project-scoped servers

Claude Code keeps per-project servers under `projects.<dir>.mcpServers` inside `~/.claude.json`, so
that file can have **no top-level `mcpServers` at all** while your agent still reaches several
servers in a given repo. toolprint reads the scope matching the working directory, and reports the
others rather than quietly missing them:

```
toolprint: skipped Claude Code (~/.claude.json): 2 other project scope(s) in this config
were not scanned — run toolprint from those directories to cover them
```

Run toolprint from a project's directory to cover that project's servers.

## Auto-discovery

With no target and no `--config`, toolprint looks in the working directory for, in order:

```
.mcp.json
mcp.json
.vscode/mcp.json
.cursor/mcp.json
```

## A URL

```bash
npx toolprint scan https://mcp.example.com/mcp
```

Transport is inferred: a `type`/`transport` hint containing `sse` selects SSE, otherwise streamable
HTTP. For authenticated servers see [Authentication](auth.md).

## An npm package

```bash
npx toolprint scan npx:@modelcontextprotocol/server-everything
```

Shorthand for running `npx -y <package>` as a stdio server.

## A raw command

```bash
npx toolprint scan "node ./my-server.js"
```

Split naively on whitespace — fine for simple commands. For anything needing quoting, use a config
file or `npx:`.

## Every client on this machine

A repo's `mcp.json` is rarely the whole story. `--all-clients` discovers and scans the MCP config of
every agent client installed on this machine:

```bash
npx toolprint scan --all-clients
npx toolprint scan --client cursor --client zed
```

Server ids are namespaced by client (`claude-code:github`, `cursor:github`) so one lockfile can hold
servers from several clients without collisions.

### Clients toolprint knows

Scanned (JSON configs): `claude-code` · `claude-desktop` · `cursor` · `vscode` · `windsurf` · `zed` ·
`gemini-cli` · `amp` · `opencode` · `ibm-bob` · `pi`

Detected but **not** scanned — their configs are TOML or YAML, which toolprint cannot parse yet:
`codex` · `goose` · `hermes` · `deepseek`

These are reported explicitly:

```
toolprint: skipped Codex (~/.codex/config.toml): TOML configs are not supported yet — not scanned
```

A trust tool must never imply coverage it does not have, so an unscannable config is announced rather
than omitted. Notes go to stderr, keeping `--json` and `--sarif` on stdout clean.

A config that simply has no MCP servers in it — a large `settings.json`, say — is skipped quietly.
That is not a coverage gap; there is nothing there to scan.

### The SkillRoute bridge

The client table is vendored from
[SkillRoute's harness manifests](https://github.com/erichare/skillroute/tree/main/harnesses), so
toolprint needs no Python and no extra install. If you _do_ have the `skillroute` CLI, `--use-skillroute`
additionally asks it where clients actually live:

```bash
npx toolprint scan --all-clients --use-skillroute
```

This executes the `skillroute` binary, so — like `--probe` — it is opt-in. If the CLI is missing or
returns something unexpected, the scan continues on the built-in table and says why. See
[Integrations](integrations.md).

## Skill bundles

```bash
npx toolprint scan --skills
npx toolprint scan --skills ./vendor/skills
```

See [Skill Bundles](skills.md).
