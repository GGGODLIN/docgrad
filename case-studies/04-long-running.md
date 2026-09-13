# Case study 4 — thirteen rounds on a private production repo

> **Last updated:** 2026-09-13

**What this measures:** what a year-shaped run of docgrad actually buys on a repository that is
maintained by people who did not build the tool's rules for themselves — and what decays anyway.
**What it does not measure:** anything you can generalise to your repo from a sample of one.

The subject is a private application repository, referred to here as **Repo P**. It has been under
docgrad since the tool's first weeks and has completed **13 convergence rounds**. It is the only
long-running subject available, and it is the one worth reading if you are deciding whether to adopt
this: [case study 1](01-commander-js.md) shows first contact with a stranger's repo, this one shows
what the hundredth day looks like.

Numbers below were re-measured from Repo P's committed state with the current scripts. Repo P's
contents, domain and file names are withheld; only counts, ratings and mechanics are reported.

## What 13 rounds looks like

★ per round, in dimension order (completeness / correctness / freshness / linkage / consistency /
economy). `—` is before that dimension existed; rounds 9 and 10 changed the corpus definition rather
than the documents, so they carry no scores.

| Round | Worked on | Ratings | Cumulative coverage |
|---:|---|---|---|
| 1 | freshness | 4 3 4 3 2 — | |
| 2 | consistency | 4 3 4 3 4 — | |
| 3 | correctness | 4 4 4 3 4 — | |
| 4 | linkage | 4 4 4 4 4 — | |
| 5 | correctness | 4 4 4 4 3 **3** | |
| 6 | consistency | 4 4 4 4 4 3 | |
| 7 | correctness | 4 4 4 4 4 3 | — / 304 |
| 8 | correctness | 4 4 4 4 4 3 | — / 319 |
| 9 | corpus scope | — | |
| 10 | corpus scope | — | |
| 11 | correctness | 4 **2** 4 4 4 3 | 24 / 357 |
| 12 | correctness | 4 4 4 4 **2** 3 | 36 / 358 |
| 13 | consistency | 4 4 4 4 4 3 | |

Three things in that table are worth more than the fact that most cells say 4.

### 1. Verified coverage is far slower than the star rating suggests

After 13 rounds the claim ledger holds **36 distinct verified claims out of a population of 358 —
10.1%**. The correctness rating has been ★4 for most of that time, and ★4 means "sample pass rate
≥90%". It does not mean 90% of the documentation has been checked; it means 90% of *what was
sampled* passed, and what was sampled is a tenth of the corpus.

This is exactly why [the rubric](../reference/rubric.md) requires the report to print cumulative
coverage next to the pass rate. A ★4 at 10% coverage and a ★4 at 60% coverage are different claims
about a repo, and the star alone cannot tell them apart.

### 2. Economy never moved — nine rounds at ★3

Economy entered at round 5 and has read ★3 in every round since. The fixed cost is **5,391 tokens**
against a ★4 threshold of ≤5,000: **391 tokens short, for nine rounds.** It got there from a much
worse position — one round moved the entry file from 9,209 tokens down to 5,391 by relocating
content out of it — and then stopped.

Put beside [case study 1](01-commander-js.md), where economy was also the single dimension five
rounds could not move, this is the clearest cross-repo pattern in any of these studies: **the loop is
good at content dimensions and bad at the cost dimension.** The content dimensions are fixed by
writing, which is what the loop does. Economy is fixed by deleting from the entry file, which trades
against completeness, and by a CI gate the loop is forbidden to install.

### 3. Ratings drop without the documentation getting worse

Round 11 shows correctness ★4 → ★2; round 12 shows consistency ★4 → ★2. Neither was caused by
somebody making the docs worse. Round 11 re-measured against a corpus that rounds 9 and 10 had
enlarged — 304 claims at round 7, 358 by round 12 — and the newly-included documents had never been
verified. Round 12's consistency drop came from re-examination finding contradictions that earlier
rounds had not sampled.

If you adopt this, expect the graph to go down sometimes, and expect that to be information rather
than regression. This is what `corpus_hash` (v1.5.0) exists for: Repo P's rounds 12 and 13 carry
`corpus_hash cf8df136` and rounds ≤11 carry none, so from here on a change of this kind leaves a
mechanical trace instead of relying on somebody writing a note.

## The graduation gate expired, and nothing said so

This is the finding that should change how you read the graduation step.

Repo P generated its CI gate at round 8, with thresholds pinned to that round's state —
`min_freshness_coverage: 0.93`, recorded in a comment as "round 8 state 0.9348". The gate was
produced, as designed, and never installed: there is no reference to it anywhere under `.github/`.

Reconstructing from document counts:

```
43/46 = 0.9348   ← matches the threshold comment exactly, so this is arithmetic, not estimation
43/48 = 0.8958   ← round 9 pulled two root documents into the corpus: denominator 46 → 48.
                   The gate is red from this round onward.
43/50 = 0.8600   ← round 10 added two more specs
45/50 = 0.9000   ← measured at the committed round-11 state
```

**The gate went red at round 9 and was noticed at round 13.** Four rounds. And the trigger was not
neglect — it was the corpus growing, which is the thing docgrad encourages. A ratio threshold frozen
at graduation expires when the denominator grows, so **normal use of the tool invalidates the tool's
own deliverable.**

The argument in [improve.md](../reference/improve.md) §Graduation is that a prose recommendation has
no deliverable so nobody acts on it, and therefore docgrad should produce a real file. Repo P shows
that producing the file solved the first problem and not the second, and that the failure mode got
worse in the process: an un-run prose recommendation leaves you *knowing* you have no gate, while an
un-run generated gate leaves you *believing* you have one. That is tracked as an open issue; the
proposed fix is for `audit` and `report` to run any existing gate and report its result, on the
grounds that the section's own premise is that users do not do things on their own.

## What the v1.5.0 and v1.6.0 fixes did here

Measured on this repo, not asserted:

- **The coverage ceiling (#37) was real and is gone — and writing this case study uncovered a second
  one.** With `correctness_sample: 12`, round 11 closed at 24 distinct claims and round 12 at 36 —
  **exactly +12**, the full new-draw quota. Under the old rule, re-verifying half of a growing pass
  set would have consumed the entire budget and left the count where it was. The ceiling's arithmetic
  said a repo freezes near `2 × correctness_sample`; this one had reached 24 with `correctness_sample`
  at 12.

  The second ceiling is further out and was undocumented: `inventory.mjs` emits only the top
  `claim_candidates_cap` candidates (default **60**), and a round can only draw from what is emitted.
  Once a ledger covers all of them, every later round draws zero and coverage freezes — while
  `claims_total` still reads in the hundreds. v1.5.0's rewritten sampling rule said coverage grows
  "with no ceiling", which was true of the mechanism it changed and false of the pipeline as a whole.
  Repo P is at 36 of a 60-wide window: **three more rounds and it would have hit a wall the
  documentation said could not exist.** v1.6.0 makes the window configurable and makes truncation
  visible in `claim_population`; the rule now says where the limit is and how to raise it. The
  finding is recorded here rather than quietly fixed because it is the same defect class this case
  study is about — a mechanical signal that reads as complete when it is a window.
- **The pollution surface is checkout-bound (#35), by a margin that crosses the downgrade
  threshold.** The same commit measures **0.1064** in the maintainer's working checkout and **0.0516**
  in a clean `git archive` extract. `pollution_max` is 0.1 — *between the two*. One untracked
  9,730-token local draft in an ignored directory is the entire difference. v1.5.0 does not change the
  ratio; it reports `untracked: {count: 1, tokens_est: 9730}` so the discrepancy is visible, and in
  the clean extract it correctly reports `null` rather than `0`, because without git it cannot know.
- **The ledger key defect (#41) happened here.** Three entries keyed on the entry file's line numbers
  were invalidated when a round moved that content into a new spec — the same economy fix that took
  the entry file from 9,209 to 5,391 tokens. They are recorded as `relocated` because neither `pass`
  nor `fail` was true. v1.6.0's content-derived `claim_hash` is what stops this recurring.

## Threats to validity

- **One repo, one maintainer, one tool author.** Repo P's owner also wrote docgrad. Its results show
  what the workflow does when followed precisely; case study 1 exists because that is not the same
  question as what it does in someone else's hands.
- **The rating scale changed underneath this history.** A dimension was added at v1.0.0, sampling
  became mechanical at v1.1.0, consistency widened at v0.5.0, and v1.6.0 changed what
  `correctness_sample` means. The per-round ★ column is therefore not a clean time series; the
  mechanical figures (token counts, coverage counts, pollution ratios) are.
- **Cumulative coverage counts distinct claims, not documents.** 10.1% of claims is not 10.1% of the
  documentation — a document can hold many claims or none.
- **The measurements labelled "working checkout" depend on one machine's untracked files** and will
  not reproduce elsewhere. That is the point of the finding, not a flaw in it.
