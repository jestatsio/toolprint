# Terms of service

_Last updated: October 15, 2026. Applies to toolprint (CLI, MCP server, plugins, and GitHub Action) by JEStats._

toolprint is free, open-source software provided under the
[Apache License, Version 2.0](https://github.com/jestatsio/toolprint/blob/main/LICENSE).
In case of any conflict, the license governs.

- **As is.** toolprint is provided "as is" and "as available", without warranties of any
  kind. Security scanning is heuristic and deterministic-hash based; no finding (or absence
  of one) is a guarantee that a server or skill is safe or malicious.
- **Your servers, your machine.** toolprint connects to MCP servers and runs the commands
  their configs declare, exactly as your agent would. Only scan servers you intend to run.
  `--probe` additionally _executes_ tools on those servers; it is off by default, warns
  first, and remains your decision.
- **Pinning is a trust decision.** `pin` records current definitions as the trusted
  baseline. Review before you pin, and review lockfile diffs like code.
- **No dependency.** JEStats may change or discontinue toolprint at any time. JEStats is not
  liable for damages arising from use of the software, to the maximum extent the Apache-2.0
  license permits.
- **Trademarks.** "toolprint" and "JEStats" identify this project; other names (Claude,
  Codex, ChatGPT, GitHub, Screaming Frog) belong to their owners. JEStats plugins are
  community distributions; directory listings do not imply endorsement by Anthropic or
  OpenAI.

Support is best-effort via
[GitHub issues](https://github.com/jestatsio/toolprint/issues).
