# CI

## The Action

```yaml
- uses: jestatsio/toolprint@v1
  with:
    config: ./.vscode/mcp.json
    fail-on: high
```

The build fails if a scan finds anything at or above `fail-on`, including drift from your committed
`toolprint.lock`.

### Inputs

| Input           | Default        | Notes                                                      |
| --------------- | -------------- | ---------------------------------------------------------- |
| `target`        | —              | Config path, `http(s)` URL, `npx:<package>`, or a command  |
| `config`        | —              | Path to an MCP client config                               |
| `skills`        | —              | A skills directory, or `true` for the default roots        |
| `fail-on`       | `high`         | `info` · `low` · `medium` · `high` · `critical`            |
| `baseline`      | —              | Prior `--json` report to compare against                   |
| `fail-on-new`   | `false`        | With `baseline`, gate only on new findings                 |
| `ignore-file`   | —              | Reviewed false positives (default `toolprint.ignore.json`) |
| `lockfile`      | —              | Lockfile to enforce                                        |
| `sarif-file`    | —              | Write SARIF here for `upload-sarif`                        |
| `comment-on-pr` | `false`        | Upsert a sticky PR comment                                 |
| `version`       | `latest`       | npm dist-tag or exact version                              |
| `github-token`  | `github.token` | Used to post the PR comment                                |

Pin `version` to an exact release if you want fully reproducible CI.

## Exit codes

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| `0`  | Clean — nothing at/above `fail-on`, and for `scan`, no drift     |
| `1`  | Operational error — couldn't connect to or parse a source        |
| `2`  | Findings at/above `fail-on` (on `scan`, drift from the lock too) |

`1` and `2` are deliberately distinct: a server that is temporarily unreachable is not the same event
as a server that turned hostile.

## Authenticated servers

Pass the token through `env` so it never appears in the workflow command or the logs:

```yaml
- uses: jestatsio/toolprint@v1
  env:
    TOOLPRINT_BEARER: ${{ secrets.MCP_TOKEN }}
  with:
    target: https://mcp.example.com/mcp
    fail-on: high
```

See [Authentication](auth.md).

## Code scanning (SARIF)

Surface findings as alerts in the **Security** tab and inline on pull requests.

```yaml
permissions:
  contents: read
  security-events: write # required to upload SARIF

steps:
  - uses: actions/checkout@v6
  - uses: jestatsio/toolprint@v1
    with:
      config: ./.vscode/mcp.json
      sarif-file: toolprint.sarif
  - uses: github/codeql-action/upload-sarif@v3
    if: always() # upload even when findings are present
    with:
      sarif_file: toolprint.sarif
```

Each check is a rule with a `security-severity`; each finding is a result, anchored to your config
(or the lockfile) with a stable fingerprint so an alert tracks across runs instead of churning.

**In SARIF mode findings do not fail the job** — they become code-scanning alerts. An operational
error still fails. Gate via branch protection on the code-scanning check, or keep a second plain
`scan` step.

## Pull-request comment

```yaml
permissions:
  contents: read
  pull-requests: write # required to post the comment

steps:
  - uses: actions/checkout@v6
  - uses: jestatsio/toolprint@v1
    with:
      config: ./.vscode/mcp.json
      fail-on: high
      comment-on-pr: true
```

A single sticky comment with a per-severity findings table, refreshed on every push. The job still
fails on findings as usual, and a comment failure never breaks the build. On a forked PR the token is
read-only, so the comment is skipped and the job stays green.

`comment-on-pr` has no effect when `sarif-file` is set — code scanning already annotates the PR.

## Scanning skill bundles

```yaml
- uses: jestatsio/toolprint@v1
  with:
    skills: ./.claude/skills
    fail-on: high
```

See [Skill Bundles](skills.md).

## Adopting on a repo that isn't clean

```yaml
- uses: jestatsio/toolprint@v1
  with:
    config: ./.vscode/mcp.json
    baseline: baseline.json
    fail-on-new: true
```

See [Baselines](baseline.md).

## Without the Action

The CLI is the whole product; the Action is a thin wrapper.

```bash
npx toolprint@0.3.0 scan --config ./.vscode/mcp.json --fail-on high --no-color
```

Exit codes are the contract, so any CI system works. Use `--no-color` for readable logs.
