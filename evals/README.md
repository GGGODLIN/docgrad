# docgrad evals

> **Last updated:** 2026-09-13

Skill-level evaluation: this measures "when an agent uses this skill to score a repo, is the
result stable and correct" — not the scripts' unit behavior (that's `tests/`,
`node --test tests/*.test.mjs`).

## Contents

- [Why they exist](#why-they-exist)
- [The three cases](#the-three-cases)
- [How to run them](#how-to-run-them)
- [Current status: the harness runs, the suite does not score yet](#current-status-the-harness-runs-the-suite-does-not-score-yet)
- [Mechanical baselines for the fixtures](#mechanical-baselines-for-the-fixtures)

## Why they exist

`tests/` has 60+ unit tests all passing, but they test the output of the five scripts,
**not the stability of the star rating**. After oikos's graduation on 2026-07-13, a same-day
re-verification found consistency went ★4→★2 — not a single unit test went red, because the
scripts weren't what was broken.

Without evals there's no way to answer "is the error on a ★4 rating ±0 or ±2," and no way to
verify whether v1.1.0's sampling mechanization actually worked. This is also what the Anthropic
skill authoring checklist's three Testing requirements (≥3 evaluations, cross-model testing,
real-scenario testing) call for.

## The three cases

| case | what it tests | pass condition |
|---|---|---|
| `linkage-known` | **reproducibility** | dead links 1/12 = 8.33% can only be linkage ★2; the rating must be identical across multiple runs |
| `planted-contradiction` | **sampling coverage** | the contradiction sits in the sentence **next to** the anchor line (no code ref) — checking only the anchor line would miss it |
| `clean-baseline` | **false positives** | a fully clean repo must not be docked; raising sensitivity must not turn into false positives everywhere |

The first two push docgrad to catch real defects; the third confirms it doesn't harm a clean
repo in the process. Drop any one of the three and the other two's conclusions become untrustworthy.

## How to run them

```bash
claude plugin eval . --runs 5
```

- `--runs 5`: **the distribution of star ratings is itself the metric**. Getting ★2/★2/★3 across
  three runs means room for discretion remains at that point — track it as a defect, don't just
  take the mode and move on.
- `--model`: the checklist requires testing Haiku/Sonnet/Opus. The rubric is a large amount of
  judgment-based zh-TW prose, and whether a weaker model can map it consistently to the right
  answer is **completely unknown** — that's exactly what this is meant to measure.
- `--threshold`: everything must be green to pass; `linkage-known`'s star rating leaves no room
  for interpretation.

## Current status: the harness runs, the suite does not score yet

`claude plugin eval` **does run now** (v1.7.0, 2026-09-14). Getting there took unpicking five
separate blockers, four of which are fixed in this directory. They are written down because each one
produced the same symptom — `score 0.00`, `judge votes: FAIL FAIL FAIL` — and a score of zero says
nothing about which layer failed.

| # | Blocker | Symptom | Status |
|---|---|---|---|
| 1 | `` `plugin eval` is currently in early access `` | exit 1, nothing runs | **Fixed**: a stale CLI build, not an entitlement. See [docs/how-to.md](../docs/how-to.md) §Run the skill-level evals |
| 2 | Graders had no `type:` frontmatter | `invalid case.yaml: graders: Required` | **Fixed**: `type: llm` added; each rubric's body is unchanged |
| 3 | Each run starts in an **empty** workspace | the fixture is not there; Claude reports it cannot read anything | **Fixed**: `case.yaml` → `context.scaffold_script` copies the fixture in and gives it its own git history |
| 4 | No `Bash` in the sandbox | the five measurement scripts cannot run at all | **Fixed**: run with `--allow-tools Bash`. A case's own `allowed_tools` cannot grant it |
| 5 | **`git` cannot execute in the sandbox** | every git-derived signal is `null`; freshness rounds down | **Open** — see below |

Blocker 4 is worth stating plainly because it is a property of this tool, not of this suite:
**docgrad's six dimensions are built on the output of five Node scripts, not on an LLM's impression
of the documents.** Without `Bash` the audit is structurally impossible, and the harness removes
ungranted tools from the session entirely. Any eval of docgrad must grant it.

### Blocker 5: git

On macOS `/usr/bin/git` is the `xcrun` shim. Inside the sandbox it cannot write its cache and so
cannot find the real binary:

```
git: error: couldn't create cache file '/var/folders/.../T/xcrun_db-SC5Pwfw0' (errno=Operation not permitted)
git: error: Failed to locate 'git'.
xcode-select: Failed to locate 'git', and no install could be requested
```

Prepending a real git to `PATH` in the invoking shell **does not help** — the sandbox does not
inherit it. `env:` in `prompt.md` cannot be used either: its keys must match `EVAL_[A-Z0-9_]*`, so
`PATH` and `TMPDIR` are not settable there.

The consequence is not one missing number. `freshness.mjs` needs `gitDate()` to produce a mismatch,
so `mismatches: []` becomes **vacuous**, the ★4 criterion "only isolated mismatches" cannot be
established, and docgrad correctly rounds down to ★3 — which then fails `clean-baseline`'s criterion
3 ("both linkage and freshness ≥★4"). **The rating was right; the input was half missing.**

Tracked separately; until it is solved the suite cannot produce a valid distribution.

### What running it anyway was worth

The run found a real defect in v1.7.0's own `#52` fix. docgrad reported *"this directory is not a git
working tree"* for a directory that **is** one — because the code inferred "not a work tree" from
"git exited non-zero", and here git exists, runs, and fails for an unrelated reason. The two
diagnoses call for opposite follow-ups. Fixed in the same release: the classification is now
three-way and carries git's own words. An eval that scored 0.00 on every case still paid for itself.

### The only reproducibility evidence so far is hand-run

Because the harness has never produced a score, the three cases were **executed by hand**, with their
`prompt.md` text unchanged and each output scored against its `graders/criteria.md`: three fixtures ×
two language arms (the English rubric and the Traditional Chinese one it was translated from) × two
runs = 12 independent audits. Results are in [case-studies/03-fixtures.md](../case-studies/03-fixtures.md).

All 12 runs passed their case's stated criteria, and 16 of 18 dimension slots were unanimous across
runs. The two that were not produced one real finding — **the correctness anchors are all written in
terms of a pass rate, and `linkage-known` has `claims_total: 0`, so an empty sample has no anchor at
all**. Four runs rated it ★3, ★3, ★1 and ★2, each defensibly. That gap belongs in
`skills/docgrad/reference/rubric.md`, not in the evals.

This is evidence, not a substitute: hand runs cannot give a distribution over many runs, and they
have no no-plugin baseline arm to compare against. Both are what the harness is for.

### Reproducing a run

```bash
claude plugin eval . --scaffold --allow-tools Bash --keep-temp
```

`--keep-temp` is not optional for diagnosis. Without it a failing case gives you `0.00` and nothing
else; with it you get each run's `trace.jsonl`, which is where every finding above came from.

## Mechanical baselines for the fixtures

The script output for the three repos under `evals/fixtures/` is fixed; the graders' assertions
are built directly on these numbers. Before changing a fixture, rerun the comparison first —
if the numbers change, update the graders accordingly:

```bash
for f in clean linkage-known planted-contradiction; do
  node skills/docgrad/scripts/links.mjs     --root evals/fixtures/$f
  node skills/docgrad/scripts/freshness.mjs --root evals/fixtures/$f
done
```

| fixture | links | dead | orphans | reachable | freshness coverage |
|---|---|---|---|---|---|
| `clean` | 3 | 0 | 0 | 1.0 | 1.0 |
| `linkage-known` | 12 | 1 | 0 | 1.0 | 1.0 |
| `planted-contradiction` | 2 | 0 | 0 | 1.0 | 1.0 |
