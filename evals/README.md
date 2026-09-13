# docgrad evals

> **Last updated:** 2026-09-13

Skill-level evaluation: this measures "when an agent uses this skill to score a repo, is the
result stable and correct" — not the scripts' unit behavior (that's `tests/`,
`node --test tests/*.test.mjs`).

## Contents

- [Why they exist](#why-they-exist)
- [The three cases](#the-three-cases)
- [How to run them](#how-to-run-them)
- [Current status: run by hand, not yet harnessed](#current-status-run-by-hand-not-yet-harnessed)
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

## Current status: run by hand, not yet harnessed

`claude plugin eval` still reports **early access** locally and can't be run:

```
$ claude plugin eval .
`plugin eval` is currently in early access
```

So all three cases were **executed by hand instead**, with their `prompt.md` text unchanged and each
output scored against its `graders/criteria.md`: three fixtures x two language arms (the English
rubric and the Traditional Chinese one it was translated from) x two runs = 12 independent audits.
Results, including the star-rating spread and what it exposed, are in
[case-studies/03-fixtures.md](../case-studies/03-fixtures.md).

Summary: all 12 runs passed their case's stated criteria, and 16 of 18 dimension slots were
unanimous across runs. The two that were not produced one real finding — **the correctness anchors
are all written in terms of a pass rate, and `linkage-known` has `claims_total: 0`, so an empty
sample has no anchor at all**. Four runs rated it ★3, ★3, ★1 and ★2, each defensibly. That gap
belongs in `skills/docgrad/reference/rubric.md`, not in the evals.

The first thing to do once harness access is granted is a `--runs 5` pass to turn that hand-measured
spread into a distribution, and to add the no-plugin baseline arm the harness provides and hand runs
cannot.

The `case.yaml` field schema is undocumented, so this suite **deliberately does not write**
`case.yaml` — better to forgo the advanced features than guess the format. `--runs`/`--model`
etc. are all passed as CLI flags.

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
