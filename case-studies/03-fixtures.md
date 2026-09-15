# Case study 3 — is the rating reproducible, and did translating it change anything?

> **Last updated:** 2026-09-16

**What this measures:** whether two runs of the same audit on the same fixture produce the same star
ratings, and whether the English rubric rates the same as the Traditional Chinese one it was
translated from.
**What it does not measure:** token savings. Nothing here supports a cost claim; it is the check
that makes [case study 1](01-commander-js.md) and [case study 2](02-docgrad-self.md) worth reading,
because a rating that moves between runs cannot support a before/after comparison.

> **Reading the versions in this study.** It was run against docgrad **v1.4.0**.
> Prose references to code — file paths, function names, output fields, config keys — describe the
> tool **as it was then**, and are deliberately left alone: rewriting them to today's layout would
> make this record assert something that was never true of the run it describes. Markdown links are
> the exception and **are** maintained against the current layout, so they still resolve.

`evals/README.md` had said these cases were "written, not yet executed". They have now been
executed. The official harness (`claude plugin eval`) refused to run, reporting
`` `plugin eval` is currently in early access ``, so the three cases were run by hand with their
`prompt.md` text unchanged, and scored against their `graders/criteria.md`.

> **Correction (v1.8.0).** This section originally said the harness "was not available on this
> account". That was wrong, and it was wrong in a way that cost time: the message means **the CLI
> build predates the command's general availability**, not that an entitlement is pending. v1.7.0
> established this and corrected `docs/how-to.md` and `evals/README.md`; this file was missed. The
> hand-run results below are unaffected — only the recorded reason for running them by hand was.

## Method

Three fixtures × two language arms × two runs = **12 independent audits**, each by a fresh agent
with no memory of the others.

| Arm | Skill read from | rubric_hash |
|---|---|---|
| EN | the translated working tree | `8b3de362` |
| ZH | the v1.4.0 plugin cache, pre-translation | `f46f90cc` |

Both arms pointed at the **same fixture files** (the fixtures are deliberately untranslated), so the
only variable is the language of the instructions the agent reads. Each run was told to follow
`SKILL.md`'s routing and blockers and to emit a fixed `STARS:` line.

Mechanical baselines of the fixtures, for reference:

| Fixture | Files | Tokens | Claims | Entry cost | Links | Dead | Orphans |
|---|---:|---:|---:|---:|---:|---:|---:|
| `clean` | 3 | 131 | 1 | 30 | 3 | 0 | 0 |
| `linkage-known` | 5 | 190 | 0 | 28 | 12 | **1** (8.3%) | 0 |
| `planted-contradiction` | 3 | 133 | 2 | 38 | 2 | 0 | 0 |

## Results

★ ratings in dimension order — completeness / correctness / freshness / linkage / consistency / economy.

| Fixture | EN run 1 | EN run 2 | ZH run 1 | ZH run 2 |
|---|---|---|---|---|
| `clean` | 4 5 4 5 4 4 | 4 5 4 5 4 4 | 4 5 4 5 4 4 | 4 5 4 5 4 4 |
| `linkage-known` | 2 **3** 4 2 4 4 | 2 **3** 4 2 4 4 | 2 **1** 4 2 4 4 | 2 **2** 4 2 4 4 |
| `planted-contradiction` | 2 2 4 **4** 2 4 | 2 2 4 **5** 2 4 | 2 2 4 **5** 2 4 | 2 2 4 **5** 2 4 |

**All twelve runs pass their case's stated criteria.** Every run on `clean` reported zero false
positives and marked freshness/economy ★4 as design ceilings rather than as fixable deductions;
every run on `linkage-known` put linkage at ★2 off the mechanical 1/12 = 8.3% dead-link ratio; every
run on `planted-contradiction` caught the planted inversion — including the detail the case exists to
test, that the contradiction sits in the sentence *next to* the sampled anchor line, which is true
rather than in the anchor line itself.

**16 of 18 dimension slots are unanimous across all four runs.** The two that are not:

### The real finding: the rubric has no anchor for an empty sample

`linkage-known` contains no code coordinates at all, so `claims_total` is 0 and the correctness
sampler draws nothing. The four runs rated that ★3, ★3, ★1 and ★2 — a three-star spread — and every
one of them explained itself well:

- ★3 reasoning: no mechanism error and no zombie document were observed, so ★1 and ★2 are
  affirmatively false; ★4 and ★5 would be vacuous; ★3 is what is left.
- ★1 / ★2 reasoning: ★3 requires "sample pass rate ≥80%", which an empty sample cannot satisfy, so
  round down per scoring principle 4.

Both readings follow the rubric. The rubric simply does not say which applies, because **every
correctness anchor is written in terms of a pass rate, and a pass rate over zero claims is
undefined**. The split correlates with the language arm here, but with two runs per arm that
correlation cannot be separated from run-to-run variance — and the mechanism does not need a
language explanation, since the gap is in the rubric, not the translation. Both arms flagged it
unprompted; one run wrote "this star reflects unmeasurability, not an observed error," which is
exactly right and is not something the current anchors let it express.

**This is a rubric defect, not a scoring accident.** Correctness needs an explicit anchor for an
empty candidate pool — or a rule that the dimension is reported as "not measurable" and excluded
from targets, the way design ceilings already are.

### The smaller one: linkage ★5 has a judged clause

One run held `planted-contradiction` at linkage ★4 while three gave ★5. Its reason: the ★5 anchor
requires anchors to use `path › symbol()`, and while `docs/balance-design.md` does, `CLAUDE.md`
references `src/balance.ts` as a bare path. Reasonable — and it shows that linkage is only
mechanical up to ★4. ★1–★4 are computed from dead-link ratio, orphans and reachable ratio and were
identical in all twelve runs; ★5 adds a clause someone has to interpret.

## Did translating the rubric change what it costs to run?

Real token usage, from Claude Code's own subagent transcripts
(`node case-studies/measure/token-usage.mjs --tag-prefix docgrad-cs3`), new input tokens per run:

| Arm | Mean | Range |
|---|---:|---|
| EN | 101,741 | 94,076 – 109,563 |
| ZH | 103,198 | 87,406 – 136,260 |

A 1.4% difference on six runs per arm, inside the spread of either arm. **Translating the skill to
English did not measurably change the cost of one audit** — even though the English corpus is 22%
larger in bytes, it is only about 4% larger in tokens, and an audit's cost is dominated by the
scripts' JSON output and the fixture reads rather than by the instruction text.

## The harness finally scored it — and it agrees with the hand runs

> **Added 2026-09-16, docgrad v1.9.0.** Everything above was executed by hand, because
> `claude plugin eval` could not produce a score until [#59](https://github.com/redtear1115/docgrad/issues/59)
> was fixed. It now can. This section is the first machine-produced distribution, and it is reported
> beside the hand runs rather than replacing them.

Three cases × five runs, `claude plugin eval . --allow-tools Bash --runs 5 --scaffold --ablation none`.
$17.94, 46 minutes.

**The star each case exists to pin was identical in all five runs, in all three cases:**

| Case | The rating under test | 5 runs |
|---|---|---|
| `linkage-known` | Linkage ★2 (dead links 1/12 = 8.33%) | ★2 ×5 |
| `planted-contradiction` | Consistency ★2 (the planted sign contradiction) | ★2 ×5 |
| `clean-baseline` | all six dimensions | identical cell for cell ×5 |

That is the reproducibility claim this case study exists to make, now measured mechanically rather
than by hand, and it agrees with the 12 hand runs above.

**What did move was the graders, and the transcripts do not explain it:**

| Case | Judge votes across the five runs | Runs passed |
|---|---|---|
| `clean-baseline` | 3/3, 3/3, 3/3, 3/3, 3/3 | 5 of 5 |
| `linkage-known` | 1/3, 3/3, 2/3, 2/3, 3/3 | 4 of 5 |
| `planted-contradiction` | 2/3, 1/3, 3/3, **0/3**, 3/3 | 3 of 5 |

`planted-contradiction`'s run 4 scored **0 of 3** while carrying the most explicit deduction of the
five — it named the sign, gave both directions, and arbitrated against the code in as many words —
and run 5 scored 3 of 3 with a terser one. The six dimension ratings were identical in both. Three
hypotheses were tested against the transcripts (`borderline` count, deduction phrasing, transcript
length); none correlates with the vote. Tracked as its own defect; it is a property of the graders,
not of the tool being graded.

**One genuine discretion gap did surface**, and it is exactly the kind `--runs 5` exists to find:
`linkage-known`'s **completeness split ★1/★2** over the same fixture (three runs at ★1, two at ★2).
It sits outside that case's pass condition, so it changed no result — but by this suite's own rule
("★2/★2/★3 across three runs means room for discretion remains at that point"), it is a defect in
the completeness anchors and is tracked separately.

## Threats to validity

- **Two runs per arm.** Enough to show a three-star spread exists; nowhere near enough to estimate
  how often it happens, or to attribute the correctness split to language rather than variance.
- **One model.** All twelve runs used the same model. Cross-model stability is untested.
- **Tiny fixtures.** 131–190 tokens each. They isolate single defects cleanly, which is what makes
  the ratings comparable, but a ★5 earned over 3 links and 1 claim carries very little evidence —
  several runs said so themselves, unprompted.
- **Hand-run, not harnessed.** The official eval runner would also score graders automatically and
  add a no-plugin baseline arm. These runs were scored by reading each output against
  `graders/criteria.md`.
