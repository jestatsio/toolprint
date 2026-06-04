# Changelog

All notable changes to toolprint are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/jestatsio/toolprint/releases/tag/v0.1.0
