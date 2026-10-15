# Privacy policy

_Last updated: October 15, 2026. Applies to toolprint (CLI, MCP server, plugins, and GitHub Action) by JEStats._

toolprint runs **entirely on your machine or in your CI**. It has no account, no hosted service,
and no telemetry: it makes no network calls of its own and sends nothing to JEStats. There is
nothing to sign up for and nothing collected about you.

## What toolprint reads

Only what you point it at:

- The MCP config files you name (or that `--all-clients` discovers in known agent-client
  locations), so it can enumerate the servers they declare.
- The definitions those MCP servers return when toolprint connects to them (tool, prompt,
  resource, and resource-template names, descriptions, and schemas), and — only under
  `--probe`, which is off by default — the output of tools it calls.
- `SKILL.md` bundles in directories you name (or the default skill roots with `--skills`).
- Your `toolprint.lock`, `toolprint.ignore.json`, and baseline files, when present.

Connections to MCP servers happen between your machine and those servers directly, over the
transports their config declares (stdio, HTTP, SSE). What those servers do with the
connection is governed by their own policies, not this one.

## What toolprint writes

- `toolprint.lock`, on `pin` only: SHA-256 fingerprints and stored descriptions of the
  capabilities you pinned, in your project, for you to review and commit.
- Reports you ask for (stdout, `--json`, SARIF, and — in CI, with your token — a pull-request
  comment via the GitHub API).

## Credentials

Authentication values you supply at run time (`--bearer`, `--header`, `TOOLPRINT_BEARER`,
`TOOLPRINT_HEADER_*`, or a bundle's environment) are used to connect to the servers you scan
and are **never written to the lockfile or any report**. Credentials toolprint _finds_ in a
config or capability text are reported redacted (a short prefix, a length, nothing usable).

## Retention, sharing, children

JEStats retains no data from toolprint, because none is transmitted. Nothing is sold or
shared. toolprint is a developer tool and is not directed at children under 18.

## Contact

Questions or issues: [github.com/jestatsio/toolprint/issues](https://github.com/jestatsio/toolprint/issues).
Security reports follow [SECURITY.md](https://github.com/jestatsio/toolprint/blob/main/SECURITY.md).
