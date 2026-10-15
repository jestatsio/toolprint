---
hide: [navigation, toc]
---

<div class="plugin-hero" markdown>

<img class="plugin-mark" src="assets/mascot.png" alt="The toolprint fingerprint guardian inspects a tool identity card with a magnifying glass, padlock in hand." width="150" height="150">
<p class="eyebrow">PACKAGE-LOCK.JSON FOR MCP TRUST</p>

# Pin what you trust.<br>Catch what changes.

<p class="lead">Your agent's MCP servers can silently rewrite the tool descriptions it reads. toolprint fingerprints every definition into a committed <code>toolprint.lock</code>, so the next change shows up as a diff in a pull request — and hidden prompt-injection and leaked secrets fail the build.</p>

<div class="install-buttons">
<a href="https://github.com/jestatsio/toolprint/releases/download/v0.4.1/toolprint-0.4.1.mcpb"><img src="assets/install-claude.svg" alt="Download for Claude Desktop"></a>
<a href="install.md#codex"><img src="assets/install-codex.svg" alt="Set up in Codex"></a>
<a href="install.md#claude-code"><img src="assets/install-code.svg" alt="Install in Claude Code"></a>
</div>

[Get started](getting-started.md){ .md-button .md-button--primary }
[Read the checks](checks.md){ .md-button }

<p class="meta">Claude Desktop · Claude Code · Codex · CLI · GitHub Action · Local only, no account</p>

</div>

<div class="plugin-grid" markdown>

<div class="plugin-card" markdown>

### Rug-pulls, caught

A pinned tool, prompt, resource, or skill whose definition changes — above all a rewritten description — fails the scan with a readable before/after diff.

</div>
<div class="plugin-card" markdown>

### Tool poisoning, flagged

Eleven injection signals scan every word your agent reads, including skill bodies. Two independent high-severity signals on one capability escalate to critical.

</div>
<div class="plugin-card" markdown>

### Secrets, redacted

Eighteen credential formats are detected in MCP configs and capability text, always redacted in output, so a leaked key is caught before it is committed.

</div>

</div>

## One command, no install

```bash
# Pin what you trust today (writes toolprint.lock — commit it)
npx toolprint pin ./.vscode/mcp.json

# From then on, scan to detect drift + issues
npx toolprint scan ./.vscode/mcp.json
```

Scan every agent client on the machine with `npx toolprint scan --all-clients`, and your
`SKILL.md` bundles with `npx toolprint scan --skills`. See [Get started](getting-started.md).

![toolprint scan detecting that a pinned tool description was rewritten to exfiltrate an SSH key](assets/screenshot-rugpull.svg)

## Built for the agent you use

The same engine ships five ways: a CLI, a GitHub Action, and an MCP server
(`toolprint serve`) packaged as plugins for Claude Desktop, Claude Code, and Codex — so your
agent can verify the very tools it is about to trust, using two tools: `scan` (read-only) and
`pin` (update the lock after review).

[Choose your installation](install.md) · [Read the source](https://github.com/jestatsio/toolprint) · [View releases](https://github.com/jestatsio/toolprint/releases)

## In CI

```yaml
- uses: jestatsio/toolprint@v1
  with:
    config: ./.vscode/mcp.json
    fail-on: high
```

SARIF output for GitHub code scanning, sticky PR comments, and baseline mode for adopting on a
repo that is not clean yet: see [CI](ci.md).

## Availability, without ambiguity

The in-repository marketplaces and release packages are community distributions by JEStats.
Compatibility and a successful installation do not imply official directory approval or
endorsement. See [Distribution](distribution.md) for what is published where, checksums, and
submission status.
