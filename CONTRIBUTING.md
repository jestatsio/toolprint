# Contributing

Thanks for helping. toolprint is a security tool, so the bar for a change is "would I trust this
gate in someone else's CI?"

## Setup

```bash
npm ci
npm run build
```

Node 20+ is required. There are no other prerequisites — the CLI has three runtime dependencies
(`@modelcontextprotocol/sdk`, `commander`, `zod`) and no Python.

## Checks

Run all of these before opening a PR; CI runs the same set.

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest
npm run test:e2e      # spawns a real npx MCP server (TOOLPRINT_E2E=1)
npm run format:check  # prettier
```

`npm run format` fixes formatting in place.

## Layout

| Path                | What lives there                                                                   |
| ------------------- | ---------------------------------------------------------------------------------- |
| `src/connect/`      | Reaching a source: MCP transports, config parsing, client discovery, skill bundles |
| `src/checks/`       | The checks and their detection patterns                                            |
| `src/lockfile/`     | Hashing, diffing, and reading/writing `toolprint.lock`                             |
| `src/report/`       | Human, JSON, and SARIF renderers, plus baselines and fingerprints                  |
| `src/outcome.ts`    | The pass/fail decision and exit codes                                              |
| `test/integration/` | Flows against the mock server in `test/fixtures/`                                  |

Tests live next to the code as `*.test.ts`; cross-cutting flows live in `test/integration/`.

## Adding a detection pattern

Patterns live in `src/checks/patterns/`. **Precision is favored over recall**: one false "this server
is malicious" accusation is worse than a missed low-signal case, because a gate that cries wolf gets
turned off. A new pattern needs:

1. A regex that essentially never fires on a legitimate description. Anchor it to concrete,
   security-relevant nouns rather than generic verbs.
2. A test with both a true positive and at least one realistic near-miss that must **not** fire.
3. A comment explaining what real attack it models.

## Adding an agent client

`src/connect/clients.ts` holds the table of where each client keeps its MCP config, derived from
[SkillRoute's harness manifests](https://github.com/erichare/skillroute/tree/main/harnesses). Add an
entry with its per-platform paths and its `format`. If the format is not `json` it will be reported
as explicitly skipped, which is correct — never let a client appear covered when it isn't.

## Commit messages

Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.

## Release process

1. Update `CHANGELOG.md` — move `[Unreleased]` into a dated version section.
2. Bump `version` in `package.json` **and** `TOOLPRINT_VERSION` in `src/version.ts`.
   `src/version.test.ts` fails if they drift.
3. `npm run typecheck && npm test && npm run build`.
4. Merge to `main`, then tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. **Move the major tag**, so `uses: jestatsio/toolprint@v1` keeps resolving:

   ```bash
   git tag -f v1 vX.Y.Z
   git push -f origin v1
   ```

   This step is easy to forget and silently breaks every pinned workflow. It is not optional.

6. Publish a GitHub release for the tag. `.github/workflows/release.yml` publishes to npm via OIDC
   trusted publishing; `prepublishOnly` re-runs typecheck, tests, and build first.

### GitHub Marketplace

The Action is listed on the Marketplace, and Marketplace validates `action.yml`
**at the release tag** — not on `main`. A metadata mistake therefore cannot be
fixed by a commit; it needs a new tagged release (0.3.1 shipped for exactly
this). `action/metadata.test.mjs` guards the rules that are otherwise invisible
until publish time: the 125-character description cap, and required branding.

### Removing a CLI flag

The Action runs `npx toolprint@latest` by default, so a workflow pinned to `@v1` pairs **old
`action.yml` with a new CLI**. Commander hard-errors on an unknown option, so deleting a flag breaks
those jobs silently. Retire a flag in two steps: hide it as a no-op for at least one minor (see
`--no-telemetry` in `src/cli.ts`), then delete it at the next major.

## Security

Do not open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md).
