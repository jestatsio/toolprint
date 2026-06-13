# Changelog

All notable changes to toolprint are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-13

### Added

- **`--probe`: opt-in tool execution + output inspection.** Toolprint stays
  read-only by default, but `--probe` now _executes_ tools and scans their
  output for the same poisoning and secret signals as the static checks (a new
  `tool-output` check). To keep the blast radius small, the bare `--probe` flag
  only runs tools the server annotates `readOnlyHint: true`, with empty
  arguments; read-only tools that require arguments are skipped. `--probe-tool
<name>` (repeatable) force-runs a specific tool regardless of annotation.
  Before executing anything, a loud warning naming the tools is printed to
  stderr (stdout stays clean for `--json`/`--sarif`). Output that combines
  injected instructions with a leaked secret escalates to `critical`.
- **More tool-poisoning patterns.** In addition to the existing set, the
  poisoning check now flags chat-template / system-prompt scaffolding
  (`<<SYS>>`, `[INST]`, `<|system|>`), instructions to act without user
  confirmation, decode-then-execute payloads, and instructions to read
  sensitive files (`~/.ssh`, `.aws`, `.env`, `id_rsa`, …).
- **More secret formats.** The secret-leak check now recognizes Anthropic
  (`sk-ant-…`), Hugging Face (`hf_…`), Google OAuth client secrets (`GOCSPX-…`),
  npm (`npm_…`), SendGrid (`SG.…`), Azure connection-string keys
  (`AccountKey=`/`SharedAccessKey=`), and database URIs with embedded
  credentials (`postgres://user:pass@…`).
- **`critical` severity tier.** When two or more independent high-severity
  injection vectors occur in the same capability (e.g. an instruction-override
  together with hidden unicode), toolprint now emits a single `critical`
  "combined attack" finding. The tier is rendered distinctly in human output.
- **GitHub Action PR comment.** A new `comment-on-pr: true` input upserts a
  single sticky comment on the pull request summarizing the scan (a per-severity
  findings table, operational errors, and a `--baseline` delta if used). Needs
  `pull-requests: write`; has no effect in SARIF mode (code scanning already
  annotates). A comment failure never breaks the build.
- **`--baseline <path>` drift-over-time.** Compare a scan against a prior
  `--json` report and see which findings are **new** and which are **resolved**
  since then, in both human and JSON output. This is informational — the exit
  code stays driven by `--fail-on` — and is the first step toward continuous
  monitoring. (`--fail-on-new`, to gate only on newly-introduced findings, is a
  natural follow-up.)
- **Richer JSON output.** The `--json` report now carries a top-level
  `generatedAt` timestamp and a stable `id` on every finding (the same identity
  used for SARIF fingerprints), so dashboards and the new `--baseline` diff can
  track a finding across runs. Both fields are additive; `schemaVersion` stays
  `1`.
- **Actionable connection errors.** When a scan can't reach a server, the error
  now appends a hint: auth flags on `401`/`403`, "is the server running?" on
  `ECONNREFUSED`, a PATH check on stdio `ENOENT`, and "raise `--timeout`" on a
  timeout. Hints only add guidance — the exit code is unchanged.
- **Version-sync guard.** `TOOLPRINT_VERSION` is now tested against
  `package.json`, fixing a drift where 0.1.1 shipped reporting `v0.1.0`.

### Fixed

- **`--version` now reports the real version.** `src/version.ts` was hardcoded to
  `0.1.0` while the package was `0.1.1`, so the CLI and every report under-reported
  the version.

## [0.1.1] - 2026-06-04

### Added

- **Authentication for remote targets.** `scan`/`pin` can now reach
  authenticated `http(s)`/`sse` MCP servers — hosted gateways and your own
  staging/prod deployments — instead of only unauthenticated ones.
  - `--bearer <token>` sends `Authorization: Bearer <token>`.
  - `--header "Name: Value"` (repeatable) sends arbitrary headers (API keys,
    custom gateway headers, …).
  - `TOOLPRINT_BEARER` and `TOOLPRINT_HEADER_*` pass the same through the
    environment, keeping secrets out of shell history, process listings, and CI
    logs. In the GitHub Action, set them via `env:` — no new input needed.
  - Config-file `headers` on `http`/`sse` entries are honored; CLI/env auth is
    layered on top and wins on a name clash.
  - Runtime auth is treated as an intentional credential: it is **never written
    to the lockfile** and **never flagged by the secret-leak check** (a secret
    hard-coded into a committed config's `headers` still is). The lockfile pins
    tool definitions only.
- **Explicit pass/fail outcome line** in human output — e.g.
  `Failed: 1 finding at or above high (exit 2).` or
  `Passed --fail-on high: 2 findings below the gate, not enforced (exit 0).` — so
  a finding below the gate is never misread as a clean run.

### Changed

- **Rug-pull drift now fails the default `--fail-on high`.** A schema/metadata
  change to a pinned capability (or a pinned capability being removed) was
  `medium`, so the documented default `toolprint scan <target>` exited `0` on it
  — CI went green on the exact thing toolprint exists to catch (#13). Any drift
  to a capability you pinned is now `high`: a changed description (as before), a
  changed input/output schema or metadata, or a removal. Drift is a
  deterministic hash comparison, so this adds no false positives. A genuinely
  new, never-pinned capability stays `low`; a brand-new server stays `info`.
  `pin` / `scan --update` still accept drift (a re-pin never fails on it).

## [0.1.0] - 2026-06-04

Initial release. toolprint is **`package-lock.json` for MCP trust** — it scans
Model Context Protocol servers for tool poisoning, leaked secrets, and silent
rug-pulls, and pins what you trust into a committed, reviewable `toolprint.lock`.

### Added

- **Scanning.** `toolprint scan <target>` connects to MCP server(s) and lists
  every tool, prompt, resource, and resource template — it never _executes_ a
  tool. Targets can be an MCP client config file, an `http(s)` URL, an
  `npx:<package>` spec, or a raw command; with no target it auto-discovers a
  config. Transports: stdio, Streamable HTTP, and (legacy) HTTP+SSE.
- **Three checks.**
  - **Rug-pull** — a tool/prompt/resource/resource-template definition that
    changed since you pinned it, headlined by a changed description (the classic
    tool-poisoning vector), rendered as a before/after diff.
  - **Tool poisoning** — instruction-injection hidden in any description, title,
    schema field, or prompt argument of any capability kind, including
    invisible / bidirectional-control unicode.
  - **Secret leak** — live-looking credentials in MCP config (`env`, `headers`,
    `url`) or capability descriptions, always redacted in output.
- **Lockfile.** A committed, diff-friendly `toolprint.lock` pins each capability
  by a stable SHA-256. `toolprint pin` (alias `scan --update`) re-pins to current
  reality; pinning **accepts drift** (a re-pin never fails on rug-pull) while
  poisoning and secret findings still gate. Writes are idempotent — an unchanged
  re-pin never churns the file.
- **Reporting.** Human-readable output, machine-readable JSON (stable schema),
  and **SARIF 2.1.0** (`--sarif`) for GitHub code scanning, with per-check rules,
  `security-severity`, and stable fingerprints.
- **CI.** A GitHub Action (`jestatsio/toolprint@v1`) with a `sarif-file` input
  for `github/codeql-action/upload-sarif`, and a documented exit-code contract
  (`0` clean, `1` operational error, `2` findings/drift).
- **Hardening.** Recursive walkers over untrusted server JSON are depth-bounded,
  so a hostile server cannot crash a scan with a pathologically nested response.

[Unreleased]: https://github.com/jestatsio/toolprint/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/jestatsio/toolprint/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/jestatsio/toolprint/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/jestatsio/toolprint/releases/tag/v0.1.0
