# JSON Output

`--json` writes a machine-readable report to stdout. **This schema is a contract**: CI configs and
downstream tooling depend on it, so fields are added rather than renamed or removed. `schemaVersion`
is `1`.

Warnings, probe notices, and skipped-config notes go to **stderr**, so stdout is always parseable.

## Shape

```json
{
  "toolprintVersion": "0.3.0",
  "schemaVersion": 1,
  "generatedAt": "2026-08-22T18:03:07.760Z",
  "summary": {
    "servers": 1,
    "findings": 2,
    "bySeverity": { "info": 1, "low": 0, "medium": 0, "high": 1, "critical": 0 },
    "operationalErrors": 0
  },
  "servers": [
    {
      "id": "mock",
      "transport": "stdio",
      "source": "node test/fixtures/mock-server.mjs",
      "capabilities": {
        "tools": 3,
        "prompts": 0,
        "resources": 0,
        "resourceTemplates": 0,
        "skills": 0
      },
      "findings": [
        {
          "checkId": "tool-poisoning",
          "severity": "high",
          "serverId": "mock",
          "capability": { "kind": "tool", "name": "helper" },
          "title": "Instruction-override phrase in tool \"helper\"",
          "detail": "This text is read by the model when it works with this tool. …",
          "evidence": "description: A helpful tool. Ignore all previous instructions and …",
          "remediation": "Confirm this wording is intentional and benign; if not, stop using this server.",
          "id": "01f3b5b760c258680b4d67401859348d35a676a7878e17448282355adf0626b2"
        }
      ]
    }
  ]
}
```

## Fields

### Top level

| Field              | Notes                                   |
| ------------------ | --------------------------------------- |
| `toolprintVersion` | The CLI that produced the report        |
| `schemaVersion`    | `1`                                     |
| `generatedAt`      | ISO-8601; lets a dashboard order runs   |
| `summary`          | Counts across all sources               |
| `servers[]`        | One entry per scanned source            |
| `update`           | Present only on `pin` / `scan --update` |
| `baseline`         | Present only with `--baseline`          |

### A source

`transport` is `stdio`, `http`, `sse`, or `skills`. When a connection failed, `error` is present and
`capabilities` is absent.

### A finding

| Field         | Notes                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `checkId`     | `rug-pull` · `tool-poisoning` · `secret-leak` · `tool-output`                                                               |
| `severity`    | `info` · `low` · `medium` · `high` · `critical`                                                                             |
| `serverId`    | Which source it came from                                                                                                   |
| `capability`  | `{ kind, name }` — absent for source-level findings. `kind` is `tool`, `prompt`, `resource`, `resourceTemplate`, or `skill` |
| `title`       | Short headline                                                                                                              |
| `detail`      | Why it matters                                                                                                              |
| `evidence`    | Offending snippet — **secrets are already redacted**                                                                        |
| `remediation` | What to do                                                                                                                  |
| `diff`        | `{ before, after }`, on a rug-pull description change                                                                       |
| `suppressed`  | `true` when [`toolprint.ignore.json`](suppressions.md) covers it                                                            |
| `id`          | Stable identity — see below                                                                                                 |

### `update`

```json
{ "lockfile": "toolprint.lock", "wrote": true, "failed": false }
```

`failed` is the same pass/fail decision the CLI makes, so a consumer does not have to re-derive it by
filtering findings. Accepted drift never sets it.

### `baseline`

```json
{
  "path": "baseline.json",
  "new": [
    /* findings */
  ],
  "resolved": [
    /* findings */
  ]
}
```

See [Baselines](baseline.md).

## Stable finding ids

`id` is a SHA-256 over `checkId`, `serverId`, `capability.kind`, `capability.name`, and `title`. It
deliberately excludes volatile evidence and diffs, which mutate as an attack changes, so one finding
keeps its identity across runs.

The same id is used for SARIF fingerprints, `--baseline` diffing, and
[suppression entries](suppressions.md) — one identity scheme, not three.

## Recipes

Exit code first, JSON second — `--json` does not change the exit code.

```bash
# Every high-or-worse finding, one per line
npx toolprint scan --json | jq -r '.servers[].findings[] | select(.severity=="high" or .severity=="critical") | "\(.severity)\t\(.title)"'

# The id to paste into toolprint.ignore.json
npx toolprint scan --json | jq -r '.servers[].findings[] | "\(.id)  \(.title)"'

# Fail a custom gate on secret leaks only
npx toolprint scan --json | jq -e '[.servers[].findings[] | select(.checkId=="secret-leak")] | length == 0'
```
