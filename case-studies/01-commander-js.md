# Case study 1 — commander.js: what converged documentation costs, and what it buys

> **Last updated:** 2026-09-13

**What this measures:** real agent token usage on one feature-design task, in a repository whose
code is identical across both arms and whose documentation is not.
**What it does not measure:** whether the docs are *better* in any sense other than the one graded.

## The subject

[`tj/commander.js`](https://github.com/tj/commander.js) at commit `ba6d13d` — a widely used
library, maintained by people with no connection to docgrad, with a documentation shape that is
common and awkward: a 43 KB `Readme.md` carrying almost everything, a thin `docs/` directory of six
files, no index, no `CLAUDE.md` or `AGENTS.md`, and translated mirrors under `docs/zh-CN/`.

```bash
git clone --depth 1 https://github.com/tj/commander.js
git -C commander.js rev-parse HEAD   # ba6d13ddb4243e5913367734f8c159089ffe7834
```

## Method

**Configuration.** An agent wrote `.docgrad.yml` from answers given as if by the repo owner, rather
than running the interactive questionnaire: `docs_dirs: [docs/]`, `docs_files: [CONTRIBUTING.md]`,
`entry_files: []` (the repo genuinely ships no always-loaded agent file), `index_file: null`,
`exclude: [docs/zh-CN/, Readme_zh-CN.md]` (translated mirrors, graded separately),
`src_dirs: [lib/]`, `scenarios: [lib/option.js, lib/command.js]`, freshness `convention: none`.

**Convergence.** `/docgrad loop`, capped at five rounds, documentation files only — no edit to
`lib/`, `tests/`, `typings/` or `package.json` (verified with `git diff --name-only`).

**The arms.** Arm A is the pristine clone. Arm B is the converged branch with `.docgrad.yml` and
`.docgrad/` removed, so the only difference between the two working trees is the documentation
itself. Each arm received the identical feature-design task three times, from a fresh agent with no
memory of the others: *design (do not implement) a JSON config file as a new option value source,
resolving between environment variables and defaults*. The task requires understanding how commander
records where an option's value came from — knowledge that lives partly in `Readme.md`, partly in
`docs/options-in-depth.md`, and partly only in `lib/`.

## What convergence did

Five rounds, then it stopped and asked for a human.

| Dimension | Before | After |
|---|---|---|
| Completeness | ★2 | ★4 |
| Correctness | ★2 | ★4 |
| Freshness | ★1 | ★4 |
| Linkage | ★1 | ★4 |
| Consistency | ★3 | ★4 |
| Economy | ★3 | **★3** (stop: needs a human) |

| Mechanical signal | Before | After |
|---|---:|---:|
| Corpus tokens | 5,567 | 9,352 |
| Fixed cost (`entry_cost`) | 0 | 0 |
| Pollution surface | 40.6% | 28.9% |
| Links | 38 | 71 |
| Broken anchors | 1 | 0 |
| Reachable ratio | `null` (no index) | 1.00 |
| `claims_total` | **0** | 26 |
| Marginal cost, `lib/option.js` | 0 (`fan_in` 0) | 3,722 (`fan_in` 2) |

Rounds: freshness (backfilled real git dates into 7 files) → linkage (created `docs/README.md` as an
index) → completeness (wrote `docs/option-values.md` and `docs/internals.md`) → correctness (fixed
three verified false statements) → economy (no edit possible; stopped).

## The A/B: three runs per arm

Design quality was graded blind first, by six independent judges — one per document, each seeing a
single document under a neutral filename, scoring six criteria 0–2 against the actual source in
`lib/`, `tests/` and `typings/`, with references to documentation files explicitly out of scope.

**Every one of the six designs scored 12/12.**

| | Arm A (pristine) | Arm B (converged) |
|---|---|---|
| Blind design score | 12, 12, 12 | 12, 12, 12 |
| `file:line` refs the judge checked | 85, 85, 70 (mean 80) | 60, 85, 72 (mean 72) |
| …of which accurate | 236/240 = 98.3% | 214/217 = 98.6% |
| False claims about current behaviour | 2 across 3 docs | 1 across 3 docs |
| Design length | mean 37.6 KB | mean 32.9 KB |

With quality tied, the cost numbers mean something. Real usage from the subagent transcripts
(`node case-studies/measure/token-usage.mjs --tag-prefix docgrad-cs1-arm`; raw data in
[`data/commander-ab-tokens.json`](data/commander-ab-tokens.json)):

| | Arm A | Arm B | Δ |
|---|---:|---:|---:|
| Assistant turns | 53 | 45 | **−15%** |
| Tool calls | 32 | 29 | −9% |
| **New input tokens** | **158,702** | **190,570** | **+20%** |
| Output tokens | 31,180 | 29,681 | −5% |
| Wall seconds | 449 | 420 | −6% |

Per-run new input: arm A 149,544 / 155,476 / 171,087; arm B 164,561 / 183,496 / 223,653. **The
ranges overlap** — arm A's most expensive run cost more than arm B's cheapest. With three runs per
arm on one model, a 20% difference in means is a direction, not a measurement.

### Converged documentation cost more, not less

The direction is the opposite of the one this case study was built to look for, and the reason is
visible in what each run actually opened:

| Arm | Documentation read |
|---|---|
| A | `Readme.md`, `docs/options-in-depth.md` (and `docs/parsing-and-hooks.md` once) |
| B | `Readme.md`, `docs/README.md`, `docs/internals.md`, `docs/option-values.md`, `docs/parsing-and-hooks.md`, `docs/terminology.md` |

**Arm B read the new documents in addition to the 43 KB `Readme.md`, not instead of it.** Nothing in
the converged tree tells an agent it can stop reading the monolith — the new index sits in `docs/`
and, because of finding 10 below, `Readme.md` does not even link to it. Convergence added a second
path without retiring the first, and an agent took both.

What it did buy: **fewer steps**. Eight fewer turns and three fewer tool calls per run, and a
slightly shorter wall clock, because arm B spent less of its budget searching. Arm A's runs are full
of `grep`-and-narrow cycles; arm B went to a named document. If the cost you care about is latency
or the number of round trips, that is a real gain. If it is tokens, it is a loss on this task.

### The docs were not the binding constraint

Every one of the six runs, in both arms, independently discovered the single fact that makes this
feature cheap to build: **`'config'` is already a reserved value source in commander** — present in
the `OptionValueSource` union in `typings/index.d.ts`, honoured by the env-overwrite guard's
`['default', 'config', 'env']` allow-list at `lib/command.js:1985`, and never produced by any code
path. Six out of six found it, all from the source, and built the design around not touching those
guards.

No document in either arm says this. The agents found it because `lib/` is readable. On a task whose
key fact lives in code, better documentation had nothing to contribute — which is exactly the
situation docgrad's economy dimension exists to price, and here economy was the one dimension the
loop could not move.

## What docgrad got wrong

The agent that ran the convergence was asked to be blunt about the tool's failures, and returned
eleven. The ones below were re-verified independently against the source and the saved JSON before
being published here; where a claim is the runner's report and was not re-checked, it says so.

**1. Economy is unreachable on any repo with a translated mirror.** Pollution surface is defined as
"whatever `exclude` names ÷ total corpus". The owner deliberately scoped out `docs/zh-CN/` because
it is graded separately — and docgrad immediately charged **40.6% pollution**, capping economy at ★3
while the fixed cost was a perfect 0 tokens. The exits are: delete the translations (improve.md
forbids it), un-exclude them (reverses the owner's answer), or write roughly 28,700 tokens of
English filler to dilute the ratio. **The rubric cannot distinguish "WIP I'm ashamed of" from
"content I deliberately scoped out of this run."** That is a definitional problem, not a tuning one,
and it is what ended the loop at "needs a human". *Verified: `pollution.ratio` 0.4059 → 0.2891 with
`entry_cost.tokens_est` 0 throughout.*

**2. On a library repo, correctness has no mechanical basis — and after convergence it grades only
docgrad's own prose.** `extractClaimLines()` recognises a claim by an inline code span shaped like a
file path. commander's documentation describes an *API* (`.option()`, `program.opts()`,
`minWidthToWrap`), not paths, so the baseline `claims_total` was **0**: the claim ledger had nothing
to sample and the audit fell back to exactly the free-form LLM sampling that `reference/audit.md`
step 3 spends a paragraph forbidding.

It gets worse after the loop writes documentation in docgrad's own `path › symbol()` house style.
All 26 candidates then come from files docgrad created:

| File | Candidates | Written by |
|---|---:|---|
| `docs/internals.md` | 15 | docgrad, round 3 |
| `docs/option-values.md` | 10 | docgrad, round 3 |
| `docs/README.md` | 1 | docgrad, round 2 |
| all seven pre-existing commander documents | **0** | — |

The sampler now verifies only the prose the tool caused to exist, while the repository's actual
documentation debt stays permanently unsampleable — and the correctness score goes **up**.
*Verified: `claim_candidates` in the saved before/after JSON.*

**3. `orphans: []` is a lie when `index_file` is null.** In `scripts/links.mjs`, the same condition
produces two different degrees of honesty:

```js
orphans:         !scoped && config.index_file ? included.filter(...) : [],    // empty array
reachable_ratio: !scoped && config.index_file && included.length > 0 ? ... : null,  // null
```

`reachable_ratio` correctly says "not computed". `orphans` returns a value indistinguishable from
"computed, and there are none". At baseline every one of commander's seven documents was unreachable
from any root, and the JSON reported zero orphans. The rubric rescues the star rating via its
"no index at all → ★1" anchor, but that is a model reading an anchor to compensate for a mechanical
signal that is wrong — and not needing that compensation is the entire selling point of a mechanical
signal. *Verified in source and in the baseline JSON (`orphans: []`, `reachable_ratio: null`).*

**4. One of the two linkage defects was a docgrad false positive, and clearing it meant editing a
file that had nothing wrong with it.** `extractHeadings()` strips an underscore whose neighbour is
not alphanumeric before slugging, so `### cmd._args` becomes `cmdargs`, while GitHub — and
docgrad's own `githubSlug()` — produce `cmd_args`, which is what commander's table of contents
already linked to:

```
extractHeadings("### cmd._args") -> ["cmdargs"]
githubSlug("cmd._args")          -> "cmd_args"    <- what GitHub actually produces
extractHeadings("### _private")  -> ["private"]   <- same bug, leading underscore
```

To get a clean mechanical number the runner added an explicit `<a id="cmd_args">` to
`docs/deprecated.md`. The stripping exists to fix a *different* false positive (a CJK heading
containing `sot_level`, per the comment in `scripts/lib.mjs`); it handles word-internal underscores
and still mangles ones preceded by punctuation. *Verified by running both functions.*

**5. `hasCodePointer()` substring-matches the bare docs directory name.** `lib/command.js` scores
`code_pointer: true` because it contains the comment `// see configureOutput() for docs`. *Verified
in source (`scripts/retrieval.mjs`) and in the baseline JSON, where `lib/command.js` is `true` and
`lib/option.js` is `false`.*

**6. `coverage.mjs` measures nothing on a flat `src_dir`, and says nothing about it.** `lib/` holds
six files and no subdirectories, so `areas: []`, `undocumented: []`, `drifted: []` and
`code_pointer_ratio: null`, before and after. Completeness's advertised mechanical basis was pure
LLM judgement for the entire run — and unlike the `src_dirs`-unset path, which emits an explanatory
`note`, this path emits nothing. *Verified in the saved JSON.*

**7. Raising freshness off ★1 required a config edit the rules do not authorise.** With
`convention: none`, `coverage_ratio` is 0 by construction and freshness is pinned at ★1 forever —
and this is not a "design ceiling", a concept that only covers ★5/CI. So `loop` would select
freshness every round and never move it. `reference/improve.md` authorises exactly one
`.docgrad.yml` edit (fixing `entry_files`); the runner changed `freshness.convention` and later
`index_file` anyway, because otherwise round 1 deadlocks. *Runner's report; the deadlock follows
from the rubric text.*

**8. The freshness ladder is not monotone.** After the backfill: coverage 100%, zero mismatches,
drift 0 — ★4 fully satisfied — while ★3's clause ("key documents have staleness ≤60 days") was
violated, every file being 107 days old. "Take the highest fully-satisfied level" returns ★4 through
a ★3 that fails. *Runner's report; reproducible from the ★3/★4 anchor text.*

**9. Backfilled dates are churn a maintainer would reject, and the tool's own diagnostic says so.**
`date_concentration` came out at 0.70 — seven of ten dates from a single backfill. The metric flags
the edit that the round was scored for making. *Runner's report.*

**10. Branch discipline blocked the edit that would make the new index discoverable.**
`docs/README.md` is now the corpus index, but commander's actual landing page is `Readme.md`, which
sits outside `docs_dirs`/`docs_files` — so improve.md's definition of a documentation change forbids
linking to the index from it. docgrad built an index that nothing outside its own corpus points at,
and scored reachability 1.00 regardless. *Runner's report; consistent with the config and the
reachability definition.*

**11. `exclude:` silently ignores root-level files.** `exclude: [Readme_zh-CN.md]` is a no-op —
files outside `docs_dirs` are never scanned, so they can be neither excluded nor counted. No warning.
*Runner's report.* This sits next to a known, separate trap: a list field written as a scalar
(`docs_files: PRODUCT.md`) makes `for…of` iterate the string character by character, every character
fails `existsSync`, and the result is that **no files are collected, with no error at all** — the
only symptom is that `files_total` does not move, which nobody associates with a malformed config.

## Threats to validity

- **Three runs per arm, one model.** Enough to see a large effect, not enough to resolve a small
  one. No statistical significance is claimed.
- **The convergence was capped at five rounds** and stopped needing a human, so arm B is a
  *partially* converged repository — economy never reached target. A fully converged arm B might
  perform differently in either direction.
- **The runner edited two files for reasons that were docgrad's fault, not commander's**: the
  `<a id="cmd_args">` anchor (finding 4) and two `.docgrad.yml` fields (finding 7). Both are in
  arm B and neither was reverted.
- **The clone is shallow (`--depth 1`)**, which silently degrades three signals: `churn_commits` is
  0 for everything, drift detection can never fire, and `index_hotness` is degenerate. Each returns
  a plausible-looking number rather than `null` or a note.
- **Both arms were measured on clean checkouts.** Untracked local files move both the corpus token
  count and the pollution surface.
