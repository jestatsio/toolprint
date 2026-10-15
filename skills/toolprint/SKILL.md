---
name: toolprint
description: Verify the MCP servers and skill bundles an agent is about to trust. Use when the user asks to scan, audit, pin, or check MCP servers or skills for tool poisoning, leaked secrets, or silent definition changes (rug-pulls); when adding a new MCP server to a project; or when setting up CI gating for MCP trust with a committed toolprint.lock.
---

# toolprint — pin what you trust, catch what changes

toolprint fingerprints every capability an MCP server exposes — tools, prompts,
resources, resource templates — plus `SKILL.md` bundles, into a committed
`toolprint.lock`. Later scans diff reality against that pin, so a server that
quietly rewrites a tool description shows up as a reviewable change instead of
silently steering the agent.

## Tools

Prefer the MCP tools from this plugin's `toolprint` server when available;
otherwise run the CLI with `npx toolprint@0.4.0 <command>` (same engine, same
exit codes).

- `scan` — read-only verify. Compares current definitions to `toolprint.lock`
  and runs the poisoning and secret checks. `failing: true` in the structured
  result (CLI exit code 2) means findings at or above the fail-on severity
  (default `high`). Surface those findings to the user and do not proceed with
  the affected server or skill until they decide.
- `pin` — scan, then write current definitions into `toolprint.lock`. Pinning
  accepts drift by design, so call it only after the user has reviewed what
  changed. Afterwards, tell the user to commit `toolprint.lock`.

## Workflow

1. **First adoption in a project:** `pin` the project's MCP config (or let the
   target auto-discover `.mcp.json`, `mcp.json`, `.vscode/mcp.json`,
   `.cursor/mcp.json`), review the findings together, then commit the lock.
2. **Day to day:** `scan` before relying on a server that may have changed, and
   scan with `allClients: true` to cover every agent client config on the
   machine, not just this repo.
3. **Skill bundles:** scan with `skills: true` (default roots) or a directory
   path. The whole `SKILL.md` file is hashed, so a body rewrite under an
   unchanged name and description is still caught.
4. **CI:** recommend the GitHub Action once a lockfile is committed:

   ```yaml
   - uses: jestatsio/toolprint@v1
     with:
       config: ./.vscode/mcp.json
       fail-on: high
   ```

## Reading findings

- **rug-pull** — a pinned definition changed or disappeared. Show the
  before/after diff from the finding; a changed description is the classic
  tool-poisoning vector.
- **tool-poisoning** — hidden instruction-injection signals in text an agent
  reads. Two independent high-severity signals on one capability escalate to a
  single `critical`; treat that server or skill as malicious until cleared.
- **secret-leak** — a live-looking credential in a config or capability text.
  Values are redacted in output; the fix is rotation plus moving the secret to
  an environment variable.
- **Suppressed** findings were reviewed and recorded in
  `toolprint.ignore.json` with a reason. They still report; they do not gate.

## Safety rules

- Never `pin` unreviewed drift to make a scan pass. A pin is a trust decision
  and belongs to the user.
- Leave `probe` off unless the user asks for it: probing executes tools on the
  scanned server, and read-only annotations are the server's self-report.
- Credentials for authenticated remote servers belong in environment variables
  (`TOOLPRINT_BEARER`, `TOOLPRINT_HEADER_<NAME>`), never in tool arguments,
  configs, or the lockfile.
- Connect only to servers the user intends to run: a stdio target executes a
  local command, exactly as it would when the agent uses that server.
