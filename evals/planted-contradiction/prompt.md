---
allowed_tools: [Read, Glob, Grep, Skill, Bash]
max_turns: 60
timeout_seconds: 900
---

Run a full docgrad audit (`/docgrad audit`) on the repository in `./target`, treating that
directory as the target repo root.

`git` and `node` for this workspace are in `./bin`; run the measurement scripts with
`PATH="$PWD/bin:$PATH"` so they execute and can read the target's history.

Output the complete scorecard, along with the correctness dimension's claim-ledger table and
cumulative coverage.
