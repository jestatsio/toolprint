# Install

toolprint is one engine with five doors. Every route below ends at the same two verbs:
**scan** (read-only verify) and **pin** (write `toolprint.lock` after review). Node.js 20 or
newer is the only runtime requirement; Claude Desktop supplies its own Node.

<div class="install-buttons">
<a href="https://github.com/jestatsio/toolprint/releases/download/v0.4.0/toolprint-0.4.0.mcpb"><img src="../assets/install-claude.svg" alt="Download for Claude Desktop"></a>
<a href="#codex"><img src="../assets/install-codex.svg" alt="Set up in Codex"></a>
<a href="#claude-code"><img src="../assets/install-code.svg" alt="Install in Claude Code"></a>
</div>

## Claude Desktop

1. Download [`toolprint-0.4.0.mcpb`](https://github.com/jestatsio/toolprint/releases/download/v0.4.0/toolprint-0.4.0.mcpb)
   (checksums are on the [release page](https://github.com/jestatsio/toolprint/releases/tag/v0.4.0)).
2. Open the file and confirm **Install**, or drag it into **Settings → Extensions**.
3. Optionally set **Default project directory** in the extension settings — where relative
   paths and `toolprint.lock` discovery start.
4. Ask Claude to scan a project's MCP config. Pass a `workingDirectory` when the project is
   not the configured default.

The bundle includes the compiled server and its dependencies; nothing is fetched at run time.

## Claude Code

In a current Claude Code session, one line installs from this repository's marketplace:

```
/plugin install toolprint --marketplace jestatsio/toolprint
```

Then confirm installation. From the shell, the equivalent two steps are:

```bash
claude plugin marketplace add jestatsio/toolprint
claude plugin install toolprint@toolprint
```

You get the `toolprint` MCP server (`scan`, `pin`), the toolprint skill, and the `/scan` and
`/pin` commands. The plugin launches the server as `npx -y toolprint@0.4.0 serve`, pinned to
an exact npm version.

## Codex

Register this repository as a marketplace once, then add the plugin:

```bash
codex plugin marketplace add jestatsio/toolprint
codex plugin add toolprint@toolprint
```

Or download [`toolprint-0.4.0-marketplace.zip`](https://github.com/jestatsio/toolprint/releases/download/v0.4.0/toolprint-0.4.0-marketplace.zip),
unzip it, and run `codex plugin marketplace add ./toolprint-marketplace` against the extracted
folder. Restart Codex and ask it to scan this project's MCP servers.

## Any MCP host

toolprint is listed in the community MCP ecosystem as a standard stdio server. The generic
config is:

```json
{
  "mcpServers": {
    "toolprint": {
      "command": "npx",
      "args": ["-y", "toolprint@0.4.0", "serve"]
    }
  }
}
```

Set `TOOLPRINT_WORKDIR` in the server environment to give scans a default project directory.
Credentials for authenticated remote servers you scan belong in the environment too
(`TOOLPRINT_BEARER`, `TOOLPRINT_HEADER_<NAME>`) — see [Authentication](auth.md).

## CLI

No install is required:

```bash
npx toolprint scan ./.vscode/mcp.json
```

Or install globally with `npm install -g toolprint`. Start with [Get started](getting-started.md).

## GitHub Action

```yaml
- uses: jestatsio/toolprint@v1
  with:
    config: ./.vscode/mcp.json
    fail-on: high
```

SARIF, PR comments, and baselines are covered in [CI](ci.md).

## Verify the install

Whichever door you chose, a first scan of the clean example should pass. Through an agent:
ask it to run a toolprint scan of your project config and report whether the result is
failing. Through the CLI: `npx toolprint scan` inside a project exits 0 when clean, 2 when
findings gate, 1 when a server cannot be reached.
