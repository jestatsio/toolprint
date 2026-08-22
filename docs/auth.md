# Authentication

Most real remote MCP servers — hosted gateways, your own staging and prod deployments — sit behind
auth.

## Flags

```bash
npx toolprint scan https://mcp.example.com/mcp --bearer "$MCP_TOKEN"
npx toolprint scan https://mcp.example.com/mcp \
  --header "X-Api-Key: $KEY" --header "X-Tenant: acme"
```

`--header` is repeatable. `--bearer <t>` is shorthand for `--header "Authorization: Bearer <t>"`.

## Environment variables (preferred)

Anything on the command line lands in shell history and in process listings (`ps`, CI logs). These
are read directly from the environment instead:

| Variable                  | Becomes                                  |
| ------------------------- | ---------------------------------------- |
| `TOOLPRINT_BEARER`        | `Authorization: Bearer …`                |
| `TOOLPRINT_HEADER_<NAME>` | `<NAME>: …` — underscores become hyphens |

```bash
export TOOLPRINT_BEARER="$MCP_TOKEN"
export TOOLPRINT_HEADER_X_API_KEY="$KEY"     # → X-API-KEY
npx toolprint scan https://mcp.example.com/mcp
```

In GitHub Actions, pass the secret through `env` so it never appears in the workflow command:

```yaml
- uses: jestatsio/toolprint@v1
  env:
    TOOLPRINT_BEARER: ${{ secrets.MCP_TOKEN }}
  with:
    target: https://mcp.example.com/mcp
```

## Declarative headers in a config

When you scan a **config file**, `headers` declared on each `http`/`sse` entry are honored, so
multi-server auth can stay declarative. Flags and environment values layer on top and win on a name
clash.

## What happens to credentials

Runtime credentials — `--bearer`, `--header`, `TOOLPRINT_*` — are treated as an intentional secret
you supplied on purpose:

- **Never written to the lockfile.** The lock pins capability _definitions_, nothing else.
- **Never flagged** by the [secret-leak check](checks.md#secret-leak).
- **Never printed.** They do not appear in human output, `--json`, SARIF, or a PR comment.

A live-looking secret hard-coded into a **committed config's** `headers` _is_ flagged — that is
precisely the leak worth catching, and the distinction is the point: a token you pass at runtime is
configuration; a token in a file in git is an incident.

## Connection failures

When a scan cannot reach a server, the error carries a hint:

| Symptom        | Hint                          |
| -------------- | ----------------------------- |
| `401` / `403`  | Check `--bearer` / `--header` |
| `ECONNREFUSED` | Is the server running?        |
| stdio `ENOENT` | Is the command on `PATH`?     |
| Timeout        | Raise `--timeout`             |

A connection failure is an operational error (exit `1`), distinct from a finding (exit `2`).
