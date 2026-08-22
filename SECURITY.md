# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it privately through
[GitHub Security Advisories](https://github.com/jestatsio/toolprint/security/advisories/new).
We aim to acknowledge within 3 business days and to ship a fix or a mitigation plan within 14 days
for confirmed issues.

Please include:

- what you can do with the issue, and what an attacker would need to pull it off,
- a minimal reproduction — a fixture config, a mock server, or a `SKILL.md` is ideal,
- the toolprint version (`npx toolprint --version`) and your Node version.

## What counts as a vulnerability in toolprint

toolprint's job is to look at untrusted input and report on it, so the interesting failure modes are
about that boundary:

| Class                    | Example                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scanner escape**       | A crafted server response or `SKILL.md` that causes toolprint to crash, hang, or consume unbounded memory (a denial of service against your CI gate).                       |
| **Silent miss**          | Input that defeats a check in a way a defender would not expect — a description that evades the poisoning patterns through encoding, normalization, or a parser difference. |
| **Secret disclosure**    | A path where a credential reaches stdout, the lockfile, a SARIF file, or a PR comment unredacted.                                                                           |
| **Unintended execution** | Anything that executes a tool, a server, or a binary without the user opting in via `--probe`, `--probe-tool`, or `--use-skillroute`.                                       |
| **Lockfile forgery**     | Two materially different capability definitions that produce the same pinned hash.                                                                                          |

A **false negative in the heuristic checks** — a poisoned description whose wording simply is not in
the pattern set — is a bug, not a vulnerability. Please
[open an issue](https://github.com/jestatsio/toolprint/issues/new) for those; new patterns are very
welcome. The same goes for false positives.

## Threat model

toolprint deliberately connects to servers it does not trust and reads files it does not trust.

- **Untrusted input:** server responses, MCP client configs, `SKILL.md` bundles, baseline reports.
  All of it is treated as hostile. Recursive walkers are depth-bounded (see `src/limits.ts`),
  discovery is bounded, and parse failures are surfaced rather than swallowed.
- **Not executed by default:** a plain scan never calls a tool. `--probe` executes tools, and it
  prints a loud warning naming them first. `--use-skillroute` executes the `skillroute` binary.
  Both are opt-in.
- **Secrets:** detected credentials are redacted before they reach any output. Credentials you
  supply at runtime (`--bearer`, `--header`, `TOOLPRINT_*`) are never written to the lockfile.
- **Out of scope:** toolprint is not a runtime firewall. It does not stop a malicious server at the
  moment your agent calls it; it stops you from adopting one, and it makes a later change visible.

## Supported versions

Fixes land on the latest minor. Given the `0.x` line, please upgrade before reporting.

## Supply chain

toolprint publishes to npm via
[OIDC trusted publishing](https://docs.npmjs.com/generating-provenance-statements) — no long-lived
token exists to leak — and every release carries a signed provenance attestation. Verify one with:

```bash
npm audit signatures
```
