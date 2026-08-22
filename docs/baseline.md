# Baselines

`--baseline` compares a scan against a **prior `--json` report** — not the lockfile — and reports
what is new and what is resolved since then.

```bash
npx toolprint scan --json > baseline.json
# …later…
npx toolprint scan --baseline baseline.json
```

```
Since baseline (baseline.json): 1 new finding, 0 resolved.
  NEW  Instruction-override phrase in tool "helper"
```

Findings are matched by their [stable id](json-schema.md#stable-finding-ids), so a report written by
an older toolprint still compares correctly.

## Baseline vs lockfile

They answer different questions, and you generally want both.

|                  | Lockfile                   | Baseline                             |
| ---------------- | -------------------------- | ------------------------------------ |
| Compares         | Capability **definitions** | **Findings**                         |
| Answers          | "Did this server change?"  | "Did our security posture change?"   |
| Catches          | A silent rug-pull          | A newly-introduced injection or leak |
| Gates by default | Yes (`high`)               | No — informational                   |

## `--fail-on-new`

On its own, `--baseline` never changes the exit code. `--fail-on-new` makes it gate — but only on
findings that are **new** since the baseline:

```bash
npx toolprint scan --baseline baseline.json --fail-on-new
```

This is how you adopt toolprint on a repo that is not clean yet. Pre-existing findings are still
reported in full; they just do not fail the build, so you can block regressions today and work
through the backlog on your own schedule.

```
Passed --fail-on high: 1 finding at or above high but not new, not enforced (exit 0).
```

The outcome line distinguishes "at or above the gate but not new" from "below the gate" and from
"suppressed", so a passing run never misrepresents why it passed.

`--fail-on-new` requires `--baseline`; using it alone is an error rather than a silent no-op.

## Adopting the pattern

1. Get a baseline and commit it:

   ```bash
   npx toolprint scan --json > baseline.json
   git add baseline.json
   ```

2. Gate on new findings only:

   ```yaml
   - uses: jestatsio/toolprint@v1
     with:
       config: ./.vscode/mcp.json
       baseline: baseline.json
       fail-on-new: true
   ```

3. As you fix things, refresh the baseline so resolved findings cannot silently come back.

## Baseline vs suppressions

Use a **baseline** for a bulk backlog you intend to work through. Use
[suppressions](suppressions.md) for a specific finding you have reviewed and decided is fine
permanently — each one carries a written reason and an optional expiry.

A baseline is a schedule; a suppression is a decision.
