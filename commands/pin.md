---
description: Pin current MCP server and skill definitions into toolprint.lock after review
argument-hint: "[target] — config path, URL, npx:<package>, or blank for auto-discovery"
allowed-tools: mcp__plugin_toolprint_toolprint__scan, mcp__toolprint__scan, mcp__plugin_toolprint_toolprint__pin, mcp__toolprint__pin, Bash(npx toolprint@0.4.1 scan:*), Bash(npx toolprint@0.4.1 pin:*)
---

Pin this project's current MCP definitions into `toolprint.lock`.

Pinning accepts drift, so first run a read-only scan and show the user what
would change — every changed, new, or removed capability, plus any poisoning
or secret findings. Only after the user confirms, call `pin` (or
`npx toolprint@0.4.1 pin`) with the same target: `$ARGUMENTS`

After pinning, remind the user to commit `toolprint.lock` so future drift shows
up in review. If poisoning or leaked-secret findings still gate the pin, stop
and work through those first — never pin dangerous state to make a scan pass.
