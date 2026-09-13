# docgrad

**English** | [繁體中文](README.zh-TW.md)

[![release](https://img.shields.io/github/v/release/redtear1115/docgrad?filter=docgrad--*)](https://github.com/redtear1115/docgrad/releases/latest) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Last updated:** 2026-09-13

> Your documentation is now read by agents, and every file an agent loads has a price. docgrad
> grades a repo's docs as an **AI-agent context source** on six dimensions, then fixes them round by
> round until they hit the targets you set.

A Claude Code skill. Six dimensions rated ★1–★5 — completeness, correctness, freshness, linkage,
consistency, and **economy**, which prices the token tax an agent pays on every single task. Five
dependency-free Node scripts produce the mechanical signals; the rating anchors are frozen in one
file so scores from different rounds stay comparable. `loop` runs until every dimension meets its
target, plateaus, or hits something only a human can decide.

## Why a sixth dimension for cost

Most documentation linters optimise one direction: more coverage, fewer broken links, better prose.
Applied to an agent's context source, that direction has a bill attached. An entry file (`CLAUDE.md`,
`AGENTS.md`) is loaded on *every* task whether or not the task needs it, and external comparisons of
coding agents on SWE-Bench Lite and AgentBench find that longer context files raise cost without
reliably raising success rate.

So economy pulls against completeness on purpose, and the loop has a mechanical brake:

| Dimension | Rated on | Signal |
|---|---|---|
| **Completeness** | Are the core areas documented at all? | `coverage.mjs` — undocumented and drifted areas, plus LLM review |
| **Correctness** | Do the claims still match the code? | Claim ledger — the script picks the sample, each claim is verified against source |
| **Freshness** | Are date signals present and honest? | `freshness.mjs` — signal coverage, staleness, git cross-check |
| **Linkage** | Can one index reach everything? | `links.mjs` — dead links, broken anchors, orphans, reachable ratio |
| **Consistency** | One authority per topic, docs and code comments alike | LLM cross-document comparison, triangulated against code |
| **Economy** | What does an agent pay per task? | `inventory.mjs` — entry-file tokens, pollution surface |

Three things stop that tension from turning into a tug of war: economy is last in the tie-break
order, documents outside `entry_files` do not count toward the fixed cost (so moving content *out*
of the entry file satisfies both dimensions at once), and each round verifies that no other
dimension dropped.

## What installing it costs you

A tool that prices context should price itself. From `claude plugin details docgrad`:

```
Always-on:   ~227 tok   added to every session
On-invoke:   ~1.8k tok  paid each time the skill fires
```

The five measurement scripts are plain Node with zero dependencies and run outside the model.

## From install to graduation

### 0. Install (once)

```bash
claude plugin marketplace add redtear1115/docgrad
claude plugin install docgrad@docgrad --scope user
```

Restart Claude Code, then run `/docgrad` — it prints its routing table and does nothing else.
Requires Claude Code and Node.js ≥18. Full install, update, and uninstall paths are
[below](#install-update-uninstall).

### 1. `/docgrad init` — configure the target repo (once)

Run it in the repo you want graded. docgrad scans for candidate structure (docs directories,
always-loaded entry files, an index, directories to exclude), walks you through a questionnaire, and
writes `.docgrad.yml` — checked into version control, shared by the team. This is the only manual
setup; every other command reads that file, and refuses to run without it.

### 2. `/docgrad audit` — see the baseline (changes nothing)

One full pass: ★1–★5 per dimension, the main deductions, and a token economy report. Pure report,
no file is touched.

```
/docgrad audit docs/infra/      # also accepts a topic, e.g. "the infra docs"
/docgrad audit --dim freshness  # one dimension only
```

Scoped reports are **never written to `.docgrad/`** — the round-by-round trend only counts full
audits, and mixing scoped scores into it destroys comparability.

### 3. `/docgrad improve` / `/docgrad loop` — converge

```
/docgrad loop     # repeat until done; use improve for one round at a time
```

Each round picks the **lowest-scoring dimension** and fixes only that one (convergence is not a
rewrite), re-rates to confirm that dimension rose and none of the others fell, then commits. Every
change lands on the `docgrad/converge` branch, one commit per round — interruptible, revertible,
reviewable as a batch before you merge.

The scores, the claim ledger and the latest scorecard live in `.docgrad/`, **and they belong in version
control**. They are state, not scratch: without them a fresh clone restarts coverage at zero and can
never detect that the rubric or the corpus definition changed under it.

`loop` stops on one of three conditions:

- **Targets met** — every dimension is at or above the targets in `.docgrad.yml` (★4 by default),
  or has been judged to have hit a design ceiling.
- **Plateau** — two rounds with zero progress; the report names the dimension it is stuck on and why
  the skill cannot move it.
- **Needs a human** — a contradiction the code cannot arbitrate, or a product decision. It lists the
  options and pauses.

A **design ceiling** means the next star on that dimension requires something docgrad is forbidden
to do — today only freshness ★5 and economy ★5, both of which demand a CI gate. Those dimensions are
marked "converged within docgrad's scope" and removed from the working set, instead of being
misreported as a plateau you could grind your way out of.

### 4. Graduation — turn the rules into CI

When every dimension meets its target, the closing report **produces graduation artifacts**:
`docs-gate.mjs` and `docs-gate.yml` under `.docgrad/graduation/`, with thresholds already set to
that repo's current numbers. **Produced, not installed** — enabling them means copying them into
`.github/` yourself. docgrad never writes to your CI configuration.

Without that gate, convergence decays: one repo sprouted fresh orphans and undated files the same
day it closed out, and was still in the same state two months later. Dead links and formatting are
better served by mature existing tools (lychee, markdownlint, Vale); what these scripts add is
orphan/reachability analysis and an entry-file token budget.

## Commands

| Command | What it does |
|---|---|
| `/docgrad init` | Scan + questionnaire → write `.docgrad.yml` into the target repo (one-time) |
| `/docgrad audit` | One full pass, emits a scorecard (changes nothing) |
| `/docgrad audit <scope>` / `--dim <dimension>` | Scoped report for a directory, topic, or single dimension (changes nothing, stores nothing) |
| `/docgrad improve` | One convergence round: pick the lowest dimension → fix → re-rate → commit |
| `/docgrad loop` | Repeat improve until targets met / plateau / needs a human |
| `/docgrad report` | Reprint the latest scorecard plus the score trend across rounds |

Routing and blockers are defined authoritatively in [SKILL.md](SKILL.md); this table is a summary.

## Install, update, uninstall

Every command below installs at **user scope** — install once, use it in every repo.

```bash
# install
claude plugin marketplace add redtear1115/docgrad
claude plugin install docgrad@docgrad --scope user

# update
claude plugin marketplace update docgrad
claude plugin update docgrad

# uninstall
claude plugin uninstall docgrad@docgrad --scope user
```

The in-session `/plugin install` dialog asks which scope to use — choose **User** there. The
Marketplaces page in `/plugin` then shows when a new version is available, and you can turn on auto
update for this marketplace. Versions and what changed are in [CHANGELOG.md](CHANGELOG.md).

### Have your agent do it

Paste this into any Claude Code session:

> Install the docgrad plugin: run `claude plugin marketplace add redtear1115/docgrad`, then
> `claude plugin install docgrad@docgrad --scope user`. Restart when it asks. Then run `/docgrad`
> and show me the routing table so I know it loaded.

To update later:

> Update the docgrad plugin: `claude plugin marketplace update docgrad`, then
> `claude plugin update docgrad`. Tell me which version I moved to, and summarise what changed in
> that repo's CHANGELOG.md between my old version and the new one.

To go from zero to a first score in one go:

> Install docgrad (marketplace `redtear1115/docgrad`, plugin `docgrad@docgrad`, user scope), then
> run `/docgrad init` in this repo, answer the questionnaire with what you can infer from the repo
> and ask me only about the entry files and the exclude list, then run `/docgrad audit` and show me
> the scorecard.

### Without the plugin system

```bash
git clone https://github.com/redtear1115/docgrad ~/.claude/skills/docgrad
```

Update with `git pull` in that directory; check [CHANGELOG.md](CHANGELOG.md) for what moved. You
lose the update notifications, nothing else.

## Case studies

Measured runs, with the commands to reproduce them. Both the numbers that flatter the tool and the
ones that do not are in there.

| | Subject | What it measures | Headline |
|---|---|---|---|
| [1](case-studies/01-commander-js.md) | `tj/commander.js` | Real agent token usage on the same feature-design task, before and after convergence | Design quality tied at 12/12 both ways; converged docs took **15% fewer turns** and pulled **20% more tokens** into context |
| [2](case-studies/02-docgrad-self.md) | docgrad itself, 9 real rounds | Where a doc system's tokens land as the product grows | Corpus grew 3.4×; the tax every task pays grew 1.8× and **halved as a share of the corpus** |
| [3](case-studies/03-fixtures.md) | The three eval fixtures | Whether the rating is reproducible at all | 12 runs, all passing; 16 of 18 dimension slots unanimous — and one real gap in the rubric |
| [4](case-studies/04-long-running.md) | A private production repo, 13 rounds | What a long run buys, and what decays | Ratings mostly ★4 — on **10.1% verified coverage**; economy stuck at ★3 for nine rounds; the generated CI gate went red four rounds before anyone noticed |

Start with [the method note](case-studies/README.md) if you intend to check the numbers.

## What it does not do

docgrad grades a **local markdown file tree**: all five scripts work on local paths, and
`.docgrad.yml` has to be writable into the target repo root.

- **git is not a hard requirement.** Without it, freshness falls back to the dates documents claim
  about themselves, coverage drift cannot be measured, and everything else runs as usual.
- **Wikis, Confluence, and other remote doc sources are not supported.** The files are not in the
  tree and the config has nowhere to live. You can still borrow the six anchors in
  [reference/rubric.md](reference/rubric.md) to rate such a source by hand — with no mechanical
  signal, no reproducibility, and no scorecard.
- **Freshness ★5 is post-graduation.** It requires a CI gate, and docgrad does not touch CI, so the
  loop caps that dimension at ★4. The default target is ★4, so this only bites if you raise it to 5.

It does not lint prose style (that is Vale's job), does not audit SKILL.md files, and does not
review code. The consistency dimension **does read code comments**, but only to judge whether a fact
has a second authority and whether it sits in the right carrier
([reference/placement.md](reference/placement.md)) — never to judge how well a comment is written.
Full positioning is in [docs/design.md](docs/design.md).

## Layout

```text
docgrad/
├── SKILL.md            # routing, blockers, the scripts contract
├── reference/          # rubric (frozen anchors), audit, improve, init, placement
├── scripts/            # five dependency-free Node measurement scripts
├── templates/          # graduation artifacts: docs-gate.mjs / docs-gate.yml
├── case-studies/       # measured runs, with reproduction commands
├── evals/              # skill-level evals (is the star rating reproducible?)
├── tests/              # unit tests for the scripts
└── docs/               # design.md, how-to.md
```

## Development

```bash
node --test tests/*.test.mjs
```

Skill-level evals — rating reproducibility, sampling coverage, false positives — are separate; see
[evals/README.md](evals/README.md). `tests/` covers what the scripts output, which cannot tell you
whether a star rating is stable.

Design notes: [docs/design.md](docs/design.md). Common development tasks:
[docs/how-to.md](docs/how-to.md). Prior work this draws on: [NOTICE.md](NOTICE.md).

## License

MIT
