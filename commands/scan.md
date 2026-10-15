---
description: Scan this project's MCP servers and skills with toolprint (read-only)
argument-hint: "[target] — config path, URL, npx:<package>, or blank for auto-discovery"
allowed-tools: mcp__plugin_toolprint_toolprint__scan, mcp__toolprint__scan, Bash(npx toolprint@0.4.0 scan:*)
---

Run a toolprint **scan** (read-only — it never writes the lockfile).

- If the user supplied an argument, pass it as the scan target: `$ARGUMENTS`
- Otherwise scan with no target so toolprint auto-discovers this project's MCP
  config, and use the current project directory as the working directory.
- Prefer the `scan` tool from the toolprint MCP server; if it is unavailable,
  run `npx toolprint@0.4.0 scan` in the shell instead.

Report the result faithfully: name every finding at or above the fail-on
severity, show the before/after text for any rug-pull (definition drift)
finding, and state clearly whether the scan is failing. If drift looks like an
update the user expected, offer the `pin` command as the next step — do not pin
without their review.
