# The Lockfile

`toolprint.lock` is the record of what you reviewed and accepted. It belongs in git, next to
`package-lock.json`.

## Format

```json
{
  "lockfileVersion": 1,
  "toolprintVersion": "0.3.0",
  "generatedAt": "2026-08-22T17:50:55.843Z",
  "servers": {
    "github": {
      "transport": "stdio",
      "source": "npx -y @modelcontextprotocol/server-github",
      "tools": {
        "create_issue": {
          "hash": "sha256:6bdb…b3f8",
          "description": "Create a new issue in a repository."
        }
      },
      "prompts": {},
      "resources": {},
      "resourceTemplates": {},
      "skills": {}
    }
  }
}
```

Each capability stores two things:

- **`hash`** — SHA-256 over the capability's complete definition. This is the trust anchor.
- **`description`** — the raw text, so drift can be rendered as a readable diff without
  re-contacting the server.

## What the hash covers

The **entire** definition object, minus volatile `_meta`: name, description, title, input schema,
output schema, annotations. Not just the description — a new parameter can widen what a tool receives
without the description changing a word.

Serialization is canonical, so the hash never flips for a cosmetic reason:

- object keys sorted recursively,
- all strings normalized to Unicode NFC,
- array order preserved (order is semantically meaningful in JSON Schema — `enum`, `prefixItems`),
- no insignificant whitespace.

A hash that flips on re-serialization would train you to ignore drift alerts, which defeats the
point.

For [skill bundles](skills.md), the hashed object includes the frontmatter _and_ the full body, so a
body-only rewrite is caught even when the name and description are untouched.

## Two modes

| Command                             | Analogue      | Behavior                                           |
| ----------------------------------- | ------------- | -------------------------------------------------- |
| `toolprint scan`                    | `npm ci`      | Read-only. Compares against the lock; drift fails. |
| `toolprint pin` (= `scan --update`) | `npm install` | Re-pins to current reality and rewrites the lock.  |

`pin` **accepts drift** — a rug-pull you are explicitly re-pinning never fails the run. But
tool-poisoning and secret-leak findings still gate: the lockfile is written, and the command still
exits `2`, so you cannot silently pin dangerous state.

A no-op re-pin does not rewrite the file, so `generatedAt` never churns your git history for nothing.

## The review workflow

This is the whole point:

1. Someone updates an MCP server, or a server updates itself.
2. `toolprint scan` in CI fails with a `high` rug-pull.
3. Whoever owns the change runs `toolprint pin` and commits the lockfile.
4. The PR now contains a `toolprint.lock` diff showing the exact before/after of every changed
   description and hash.
5. A human reads that diff and approves — or doesn't.

Step 5 is the security control. The lockfile just makes it impossible to skip.

## Location

The nearest `toolprint.lock` is used by default. Override with `--lockfile <path>`:

```bash
npx toolprint scan --lockfile ./config/toolprint.lock
```

## Server ids

Lockfile keys come from the target:

| Target          | Key                                              |
| --------------- | ------------------------------------------------ |
| A config entry  | its key in `mcpServers` — e.g. `github`          |
| `--all-clients` | namespaced by client — e.g. `claude-code:github` |
| `--skills`      | `skills:` plus a relative or `~`-normalized path |

Skill paths are recorded relative to the working directory (or to `~`) so a committed lockfile does
not churn when a teammate checks the repo out somewhere else.

## Compatibility

`lockfileVersion` is `1`. New capability kinds are added as new optional records that default to
empty — `resourceTemplates` and `skills` both arrived this way — so a lockfile written by an older
toolprint keeps validating.
