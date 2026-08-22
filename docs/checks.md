# Checks

Four checks run on every scan. Each produces `Finding`s with a severity; the highest severity
decides the exit code via `--fail-on` (default `high`).

| Check id         | What it compares                                                | Needs a lockfile? |
| ---------------- | --------------------------------------------------------------- | ----------------- |
| `rug-pull`       | Current definitions against `toolprint.lock`                    | Yes               |
| `tool-poisoning` | Agent-readable text against 11 injection signals                | No                |
| `secret-leak`    | Config values and capability text against 18 credential formats | No                |
| `tool-output`    | What a tool _returns_, under `--probe`                          | No                |

## Precision over recall

One false "this server is malicious" accusation is worse than a missed low-signal case, because a
gate that cries wolf gets turned off. Every heuristic pattern is anchored to concrete,
security-relevant nouns rather than generic verbs, and each one ships with a near-miss test that must
not fire.

The one check with **no heuristic at all** is `rug-pull`: it is a deterministic hash comparison, so
gating on it can never cost you a false positive. That is why it is `high` by default.

## `rug-pull`

Everything you pinned is hashed with SHA-256 over its complete definition — name, description, input
and output schema, title, annotations — minus volatile `_meta`. Any difference is drift.

| Situation                                            | Severity |
| ---------------------------------------------------- | -------- |
| A pinned capability's **description** changed        | `high`   |
| A pinned capability's **schema or metadata** changed | `high`   |
| A pinned capability **disappeared**                  | `high`   |
| A **new**, never-pinned capability appeared          | `low`    |
| The whole server has no lockfile entry yet           | `info`   |

A changed description is the classic tool-poisoning vector, but schema drift matters just as much: a
new parameter can widen what a tool receives without a word of the description changing.

Applies to every capability kind — tools, prompts, resources, resource templates, and
[skills](skills.md).

## `tool-poisoning`

Instruction injection hidden anywhere the model reads. toolprint walks the entire capability object
and inspects every `description`, `title`, and `instructions` string it finds — at the top level, in
tool input/output schemas, in prompt arguments, in resource metadata, in a skill's body — tagging
each hit with the JSON path where it was found.

| Signal                 | What it models                                                |
| ---------------------- | ------------------------------------------------------------- |
| `ignore-instructions`  | "Ignore all previous instructions" and variants               |
| `hide-from-user`       | "Do not tell the user", "never mention this"                  |
| `exfiltration`         | Sending `.ssh`, `.aws`, `.env`, keys, or tokens somewhere     |
| `read-sensitive-files` | Reading `id_rsa`, `.ssh`, `.aws`, `.netrc`, `/etc/passwd`     |
| `before-other-tools`   | "Before using any other tool, first…" — a covert precondition |
| `model-scaffolding`    | Chat-template tokens: `<<SYS>>`, `[INST]`, `<\|system\|>`     |
| `no-confirmation`      | "Without asking the user", "no need to confirm"               |
| `decode-execute`       | "Base64-decode this and run it"                               |
| `hidden-directive-tag` | `<IMPORTANT>`, `<SECRET>`, `<SYSTEM>` pseudo-tags             |
| `hidden-unicode`       | Zero-width and bidirectional-control characters               |
| `encoded-blob`         | A long base64-like run where prose belongs                    |

### The `critical` tier

When **two or more independent high-severity signals** land on the same capability — say an
instruction-override _and_ hidden unicode — toolprint collapses them into one `critical` "combined
attack" finding. Any one signal can be a coincidence; that combination essentially never is.

## `secret-leak`

Live-looking credentials in two places:

1. **Your MCP config** — `env` values, `headers`, and the `url` of each server entry. These are
   usually committed, which is what makes them worth catching.
2. **Capability text** — a key accidentally pasted into a description.

18 formats are recognized, including OpenAI (`sk-…`), Anthropic (`sk-ant-…`), AWS access keys, GCP
service-account keys, GitHub tokens (`ghp_`, `gho_`, …), Hugging Face (`hf_`), Stripe, Slack, npm
(`npm_`), SendGrid (`SG.`), Google OAuth (`GOCSPX-`), Azure connection-string keys, and database URIs
with embedded credentials (`postgres://user:pass@…`).

**Matches are always redacted** before they reach stdout, JSON, SARIF, or a PR comment.

Credentials you pass at runtime — `--bearer`, `--header`, `TOOLPRINT_BEARER`, `TOOLPRINT_HEADER_*` —
are intentional and are never flagged, and never written to the lockfile. See
[Authentication](auth.md).

## `tool-output`

Only produces findings when you opt in with [`--probe`](probing.md). It runs the same poisoning and
secret engines over what a tool actually returns, catching an attack staged in output rather than in
a description. Output that combines injected instructions _with_ a leaked secret escalates to
`critical`.

## Tuning what fails

```bash
npx toolprint scan --fail-on critical   # only the combined-attack tier fails
npx toolprint scan --fail-on low        # gate new, unpinned capabilities too
```

For a specific finding you have reviewed and accepted, use [Suppressions](suppressions.md) rather
than lowering the gate for everything.
