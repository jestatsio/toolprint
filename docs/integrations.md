# Integrations

## SkillRoute

[SkillRoute](https://github.com/erichare/skillroute) and toolprint cover the two halves of the same
problem. Both deal with **text an agent reads and then obeys**:

|           | SkillRoute                                                                          | toolprint                                   |
| --------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| Substrate | `SKILL.md` bundles                                                                  | MCP capability definitions                  |
| Question  | Which one should the agent use?                                                     | Should the agent trust it at all?           |
| On skills | Indexes, routes, validates against the [spec](https://agentskills.io/specification) | Scans for injection, pins against rug-pulls |
| Overlap   | none — spec compliance is not a security check                                      |                                             |

They integrate in both directions.

### SkillRoute → toolprint: knowing where every client lives

toolprint's own auto-discovery covers four project-local paths. SkillRoute maintains manifests for
**15 agent harnesses** across three platforms, including where each keeps its MCP config.

That table is vendored into `src/connect/clients.ts` and powers
[`--all-clients`](targets.md#every-client-on-this-machine):

```bash
npx toolprint scan --all-clients
```

It is **vendored, not imported**, so toolprint keeps its "no install, no Python" promise and works
whether or not SkillRoute is present.

If you do have the `skillroute` CLI, `--use-skillroute` layers its live detection on top:

```bash
npx toolprint scan --all-clients --use-skillroute
```

This runs `skillroute harness detect --json`, which reports which harnesses are actually installed
and their resolved config paths — picking up clients added to SkillRoute after your toolprint was
published. Because it executes a third-party binary, it is opt-in, the same way `--probe` is. A
missing or unexpected response degrades to the built-in table and says so.

### toolprint → SkillRoute: security for skill bundles

SkillRoute's `validate` answers "is this bundle well-formed?" toolprint answers "is it safe, and is
it still the one you reviewed?" Run both:

```bash
skillroute validate ./skills --strict     # spec compliance
npx toolprint scan --skills ./skills      # injection + rug-pull
```

See [Skill Bundles](skills.md) for what the security pass actually catches.

### Scanning SkillRoute itself

SkillRoute ships an MCP server, so it is a scan target like any other:

```bash
npx toolprint scan npx:@skillroute/mcp-server
npx toolprint pin  npx:@skillroute/mcp-server
```

## MCP clients

Any client whose config toolprint can read is covered — see
[the client list](targets.md#clients-toolprint-knows). Adding one is a data change in
`src/connect/clients.ts`; see [CONTRIBUTING.md](../CONTRIBUTING.md).

## GitHub

- **Code scanning** — `--sarif` emits SARIF 2.1.0 for `github/codeql-action/upload-sarif`.
- **Pull requests** — `comment-on-pr: true` upserts a sticky findings table.

Both in [CI](ci.md).

## Anything else

`--json` is a stable, documented contract — see [JSON Schema](json-schema.md). Every finding carries
a stable `id`, so dashboards and baselines can track one finding across runs.
