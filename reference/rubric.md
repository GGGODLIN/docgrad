# docgrad rubric — star anchors for the six dimensions

> **Last updated:** 2026-09-13

> This file is the only basis on which scores from different rounds can be compared. The anchors
> are frozen; any change to them makes historical scores incomparable, counts as a breaking
> change, and must be stated explicitly in the commit message.

## Contents

- [Scoring principles](#scoring-principles)
- [Mechanical signal → dimension map](#mechanical-signal--dimension-map)
- [Completeness](#completeness)
- [Correctness](#correctness)
- [Freshness](#freshness)
- [Linkage](#linkage)
- [Consistency](#consistency)
- [Economy](#economy)
- [Token economy report](#token-economy-report)
- [Version history and comparability notes](#version-history-and-comparability-notes)

## Scoring principles

1. Run the five scripts first (inventory / links / freshness / coverage / retrieval); mechanical
   signals are reproducible.
2. The LLM-judged dimensions (completeness, correctness, consistency) are matched against the
   anchors in this file. Inventing your own criteria is not allowed.
3. Star ratings are whole numbers, ★1–★5. Take the highest level the docs *fully* satisfy.
4. When in doubt, round down — a conservative score gives the loop a clear direction to work in.
5. Fixed dimension order (ties break toward the earlier one): completeness → correctness →
   freshness → linkage → consistency → economy. Economy is last on purpose: it pulls against
   completeness (adding documentation raises the fixed cost), so on a tie the content dimensions
   move first and the loop does not oscillate between "write more" and "delete it again".

## Mechanical signal → dimension map

| Script | Feeds |
|---|---|
| inventory.mjs | **Economy (fully mechanical: `entry_cost` + `pollution`)**; the inventory completeness works from; `structure.rules` feeds traceability |
| coverage.mjs | Completeness (coverage drift: undocumented/drifted areas) |
| links.mjs | Linkage (fully mechanical) |
| freshness.mjs | Freshness (mostly mechanical) |
| retrieval.mjs | Marginal cost (when `scenarios:` is set) plus traceability — **both report-only, neither rates economy** |
| (no script) | Correctness, consistency (LLM claim ledger / cross-document triangulation) |

## Completeness

| Star | Anchor |
|---|---|
| ★1 | Most core modules have no documentation; an agent can only read the code and infer. |
| ★2 | Scattered documents exist, but at least one key area — deployment, testing, data model — is missing entirely. |
| ★3 | Every core area has an authoritative document; deployment/testing are at least described inline. |
| ★4 | All areas covered, common tasks have how-tos; only a few edge modules are missing. |
| ★5 | Full coverage + runbook + onboarding path + retired mechanisms explicitly marked "do not use for new work". |

Measurement: the undocumented/drifted area list from coverage.mjs is the mechanical basis (degraded
to pure LLM comparison when `src_dirs` is not set); the LLM then scans the top-level `src` structure
and the deployment/testing setup to catch gaps the script cannot see (subsystem granularity,
`mentioned_by` false positives). An undocumented or drifted area counts as that area having no
authoritative document.

## Correctness

| Star | Anchor |
|---|---|
| ★1 | Sample pass rate <50%, including mechanism-level errors (the architecture described no longer exists). |
| ★2 | Pass rate 50–79%, or an entire document describes a retired mechanism with no marking of any kind. |
| ★3 | Sample pass rate ≥80%; what is wrong is detail, not mechanism. |
| ★4 | Sample pass rate ≥90%, and no zombie-mechanism documents. |
| ★5 | Every sampled claim passes + zombie code and retired mechanisms are marked + authoritative lists refer to code instead of restating it. |

Measurement: the claim ledger — draw `correctness_sample` concrete claims, re-verify part of the
existing ledger, and verify every one of them against the code (see [audit.md](audit.md) step 3).
**The script decides the sample**: the population is `inventory.totals.claims_total` (non-heading
lines outside fences that carry a code coordinate), the draw order is
`inventory.claim_candidates` (stably sorted by ref count → path → line), at most 2 per document.
**`correctness_sample` is the number of claims drawn new each round, not the total verified that
round.** A round verifies: every outstanding `fail`/`stale` entry in `.docgrad/ledger.jsonl` (no
cap — otherwise a repo's score would improve as its documentation got worse), plus the
`floor(correctness_sample / 2)` least-recently-verified `pass` entries (by ledger `round`
ascending), plus `correctness_sample` claims that have never entered the ledger. Re-verification
never reduces the new draws, so cumulative coverage grows by `correctness_sample` per round with no
ceiling; the ledger accumulates rather than resampling. The pass rate that sets the star rating is
computed over that whole verified set.

> **Report pass rate and coverage separately**: the star rating for this dimension follows the
> **pass rate** (passes ÷ claims verified this round). **Cumulative coverage** (distinct claims in
> the ledger ÷ `claims_total`) does not affect the star rating, but **the report must include it** —
> 8/8 at 5% coverage and 8/8 at 60% coverage are two different things, and giving only the star
> rating lets the reader overestimate how much that number is worth.

> **Zero verifiable claims: not measurable, not a star.** When the round's verified set is empty —
> no outstanding `fail`/`stale`, no `pass` entries in the ledger, and `claims_total: 0` — the pass
> rate is undefined and **none of the ★1–★5 anchors above apply**. Report the dimension as `n/a`
> (not measurable) rather than guessing a star; four independent runs on the same library-repo
> fixture, each reasoning defensibly, produced ★3, ★3, ★1 and ★2. A not-measurable correctness is
> treated exactly like a design ceiling: excluded from the targets check, excluded from the loop's
> dimension picking, and named in the report — the corpus having no claim that carries a code
> coordinate is itself the finding worth acting on (see [audit.md](audit.md) step 3). The rated
> value recorded in `history.jsonl` is `null`, not a number, so `report` never averages a guess.
> This adds a case the anchors did not cover; it **changes none of the ★1–★5 thresholds**
> (see [§Version history](#version-history-and-comparability-notes)).

## Freshness

| Star | Anchor |
|---|---|
| ★1 | No date-signal convention (coverage_ratio <20%). |
| ★2 | Signals are scattered (20–60%), or key documents have staleness >180 days. |
| ★3 | A date-signal convention exists but relies on discipline; key documents have staleness ≤60 days. |
| ★4 | Coverage ≥90%, only isolated mismatches, drift <30 days. |
| ★5 | Full coverage + "updated in the same MR as the change" enforced by a mechanical gate + lifecycle management (superseded documents handled as soon as they are superseded). |

Measurement: `coverage_ratio` / `stale` / `mismatches` from freshness.mjs. "Key documents" means
`entry_files` + `index_file` + each area's authoritative document.
The git date comparison **excludes docgrad's own convergence commits** (the `docs(docgrad):`
prefix) and takes the most recent non-docgrad commit — otherwise the backfill round counts its own
commit dates as "the content was updated" and produces false mismatches.
`date_concentration` is an advisory field (**it does not affect the star rating**): a high share of
a single day means the signals come from one backfill, the coverage number does not reflect how the
docs are actually maintained, and the report must say so.

> **Scope of ★5 (graduation-only)**: the "mechanical gate" ★5 requires means touching CI, and
> improve/loop are bound by Blocker #3 not to touch the target repo's CI — so freshness is capped
> at ★4 inside the loop and the dimension is called a design ceiling (see [improve.md](improve.md)).
> ★5 is reachable only after graduation, once the team builds its own docs-gate CI.
> This is a note about reachability and **changes none of the ★1–★5 thresholds**
> (see [§Version history](#version-history-and-comparability-notes)).

## Linkage

| Star | Anchor |
|---|---|
| ★1 | Dead-link ratio >10%, or no index at all. |
| ★2 | Dead links 2–10%, or orphans >20%. |
| ★3 | Broken relative links ≤2%; an index exists but is not the single entry point. |
| ★4 | Zero dead links, orphans ≤5%, reachable_ratio ≥95%. |
| ★5 | Zero dead links + a single top-level index reaches everything transitively (zero orphans) + anchors use `path › symbol()` so they survive line-number drift. |

Measurement: the full mechanical output of links.mjs (dead-link ratio = dead_links / total_links).
Broken anchors always cost stars; `cjk_uncertain` is an advisory field and is **not** a reason to
skip confirmation (see [§Version history](#version-history-and-comparability-notes)).

> **`orphans: null` is not `orphans: []`.** When the repo has no `index_file`, or the run is scoped,
> reachability cannot be computed and both `orphans` and `reachable_ratio` come back `null`. Do not
> read that as "no orphans found". A repo with no index at all is rated ★1 by the anchor above — the
> one case where every document can be unreachable while the mechanical output reports nothing.

## Consistency

| Star | Anchor |
|---|---|
| ★1 | The same topic is contradicted in several places with no clue how to arbitrate. |
| ★2 | Many overlaps, at least one pair in substantive contradiction. |
| ★3 | At most 2 overlaps per topic and they do not contradict each other. |
| ★4 | Mostly one authority per topic, with cross-links at the individual overlaps. |
| ★5 | One authority per topic (everywhere else keeps a summary plus a link) + an explicit conflict-arbitration convention (newer wins + arbitrate against the code). |

Measurement: the LLM picks 3–5 key factual topics (architecture, state machines, deployment…),
compares them across documents, and triangulates against the code. The scope of the judgement
**includes placement and duplication between docs and code comments/specs** — the rules are in
[placement.md](placement.md), and only placement and duplication are judged, never comment quality.
Deductions fall into three classes: `[contradiction]` / `[duplication]` / `[placement]`
(see [audit.md](audit.md) step 6).
When comparing this dimension's score across v0.5.0, note the scope was widened
(see [§Version history](#version-history-and-comparability-notes)).

## Economy

| Star | Anchor |
|---|---|
| ★1 | Fixed cost > 20,000 tokens. |
| ★2 | Fixed cost > 10,000 and ≤ 20,000. |
| ★3 | Fixed cost > 5,000 and ≤ 10,000. |
| ★4 | Fixed cost ≤ 5,000 and pollution surface < 10%. |
| ★5 | Fixed cost ≤ 3,000, pollution surface < 10%, and the entry-file token budget is enforced by a mechanical gate. |

Measurement: **fixed cost** = `inventory.entry_cost.tokens_est` (the tax every task pays for
loading `entry_files`, with symlink aliases de-duplicated); **pollution surface** =
`inventory.pollution.ratio`. Both are fully mechanical, neither passes through LLM judgement.

> **Pollution downgrade rule**: at a pollution surface ≥ 10%, this dimension is capped at ★3 no
> matter how low the fixed cost is. Without this rule, "fixed cost 4,000 + pollution 15%" would
> satisfy neither ★3 (cost too low) nor ★4 (pollution too high) and there would be no star to give.

> **This dimension pulls against completeness by design, not by accident**: adding documentation
> raises the fixed cost. Economy exists so the loop has a mechanical brake between "more
> documentation" and "a more expensive agent" — external evidence (several coding agents compared
> on SWE-Bench Lite and AgentBench) shows that longer context files raise cost without necessarily
> raising success rate, so coverage cannot be the only direction that gets rewarded. Three things
> keep it from turning into a tug of war: economy is last in the dimension order (on a tie the
> content dimensions move first), documents outside `entry_files` do not count toward the fixed
> cost (moving content out of the entry file satisfies both dimensions at once), and improve
> verifies that no other dimension drops.

> **Scope of ★5 (graduation-only)**: the "mechanical gate" ★5 requires means touching CI, and
> improve/loop are bound by Blocker #3 not to touch the target repo's CI — so economy is capped at
> ★4 inside the loop and the dimension is called a design ceiling
> (see [improve.md](improve.md)), the same way freshness ★5 is.

## Token economy report

Since v1.0.0, **fixed cost and pollution surface are rated** (see [§Economy](#economy)); this
section expands on that dimension and adds two signals that remain report-only (marginal cost,
traceability) and take no part in the rating.

- **Fixed cost**: `inventory.entry_cost.tokens_est` (`entry_files`, loaded on every task). **Rated.**
- **Marginal cost** (report-only): when `.docgrad.yml` sets `scenarios:` (a list of representative
  code paths), `retrieval.mjs` computes it mechanically — each scenario reports `marginal_tokens`
  (entry_files + every doc on the index chain + every anchoring doc, each file counted once),
  `max_depth` (how many hops from `index_file` to the furthest anchoring doc), `fan_in` (how many
  docs anchor it) and `code_pointer` (whether the code on that path points back at any doc) —
  and weights them by `churn_commits` (commits in the last 90 days) to name the most heavily taxed
  scenario: high churn together with high `marginal_tokens` or deep `max_depth` means the agent
  touches it often and pays the most to retrieve it, so it is the one to fix first. Without
  `scenarios:`, fall back to the old method: the LLM simulates the required reading path from
  `.docgrad.yml`'s `scenario` (singular, a prose string).
- **Pollution surface**: `inventory.pollution.ratio` (excluded directories and WIP as a share of the
  whole corpus). **Rated.**
- **Interpretation**: the report must include a break-even statement — an overstuffed entry file
  means every task pays a fixed tax; routing everything through the index means paying the marginal
  cost of multi-hop retrieval. Give a trade-off recommendation based on what that repo's tasks
  actually look like.

### Traceability (report-only)

A newer signal, measuring "is there a path from a code file back to the spec that governs it, and is
that spec usable" — it **affects none of the ★1–★5 anchors** and is only an extension of the token
economy report. The mechanical basis is `retrieval.mjs` (`code_pointer_ratio` / `index_hotness`) and
`inventory.mjs` (`structure.rules`).

- **`code_pointer_ratio`** (aggregated from retrieval.mjs `areas[].code_pointer`): whether the code
  under each first-level subdirectory of `src_dirs` points back at any doc (a `docs_dirs` path
  prefix, or the basename of some doc). A low ratio means an agent that just changed the code has no
  path back to the spec and can only grep the whole doc tree and guess.
- **`index_hotness`** (retrieval.mjs): commits in the last 90 days on `index_file` / `entry_files`
  versus the median across all docs. A `ratio` clearly >3 usually means the index or entry file has
  absorbed content that the child documents should be exposing themselves — the index should be
  pointing the way, not being edited along with the content. It can also be plain orphan maintenance
  debt; read `top5` to tell which.
- **`structure.rules`** (inventory.mjs, per file): for rule lines (matched by `rules.pattern`,
  default `**MUST`), the `median_chars` / `p90_chars` / `anchored_ratio`. A median above 300
  characters or an `anchored_ratio` below 0.5 is a signal to split that file into a **contract
  layer** (the rules themselves: short, with coordinates) and a **detail layer** (background and
  examples, which may be long) — long rule lines mixed with background narrative force the agent to
  read the whole passage every time to find the one sentence that is actually a MUST, and a low
  anchored ratio means the claims have no verifiable landing point in the code.

## Version history and comparability notes

Only needed when comparing scores across versions; day-to-day scoring does not need to expand this.
None of the items below **changed the ★1–★5 anchor text of an existing dimension**; the only
breaking change is v1.0.0 adding a dimension (the set of dimensions changed, the ruler for each
individual dimension did not).

<details>
<summary>Expand</summary>

- **Translation to English (see CHANGELOG)** (**anchor text changed; thresholds did not**): the
  whole file was translated from Traditional Chinese to English. What survived unchanged: every
  numeric threshold (`≤ 10,000`, `≥90%`, `<50%`, the tier lists) and the dimension order that
  breaks ties. What did not: the qualitative anchor text itself, which is now different prose.
  That matters, because the qualitative anchors *are* the ruler — a model reads that text and
  decides where a repo falls, and "the same meaning in another language" is an assertion nobody
  can mechanically check. So `rubric_hash` changes here and `report` draws a comparability break,
  and **the break is real**: a ★4 awarded against the Chinese anchors and a ★4 awarded against the
  English ones were read off different text. Mechanical dimensions (linkage, economy, and the
  mechanical part of freshness) are unaffected — no LLM reads this file to compute them.
  A structural hash — over the thresholds and the anchor ordering rather than the file bytes —
  would tell translations apart from real rubric changes and remove this whole class of false
  breakpoint. It is not implemented; see the repo's open issues.
- **`correctness_sample` now means new draws per round, and the empty-sample case is defined**
  (see CHANGELOG; issue #37) (not an anchor change): the ★1–★5 thresholds (pass rate <50% / 50–79% /
  ≥80% / ≥90% / all pass) are unchanged word for word. Two things changed underneath them. First,
  what the number means: it used to be the *total* claims verified in a round, with re-verification
  spending out of the same budget, so new draws were `correctness_sample − (#fail + ⌈#pass/2⌉)` and
  hit zero at a ledger of `2 × correctness_sample − 1` claims — oikos froze at 23 of 335 candidates
  (7%) and no further round could move it. It is now the number of claims drawn *new* each round,
  and re-verification (all outstanding fail/stale, plus `floor(correctness_sample / 2)`
  least-recently-verified passes) is a separate budget on top, so cumulative coverage grows by
  `correctness_sample` per round without a ceiling. Second, the verified set's composition: it used
  to be dominated by re-verified passes as the ledger grew — claims already known to be correct —
  and is now always majority-fresh. **So pass rates before and after are computed over differently
  composed sets and are only loosely comparable**: an old score leans on re-checks of claims that
  already passed and therefore reads high, the more so the larger the ledger was at the time, while
  a new score is mostly unseen claims and is the harsher measurement. Treat a pre-change ★4 as no
  stronger than a post-change ★4, never the reverse, and re-read the cumulative coverage next to it
  — coverage trajectories across this change are not comparable at all, since the old one was
  approaching a ceiling that no longer exists. Also new: a corpus with `claims_total: 0` reports
  correctness as `n/a` (not measurable) instead of receiving a star. That is an added case, not a
  moved threshold — those repos previously had no applicable anchor and got whatever a given run
  decided (★3, ★3, ★1 and ★2 on four runs of one fixture), so their historical correctness scores
  are not meaningful values to compare against anything.
- **v1.3.0 — freshness git comparison excludes docgrad's own commits** (not an anchor change): the
  ★1–★5 thresholds are untouched, but the basis for computing mismatches changed — a backfill round
  no longer pollutes itself. When comparing freshness scores across v1.3.0, older scores may be
  depressed by false mismatches (38 of them measured on oikos round 2). Adds the advisory field
  `date_concentration`, report-only.
- **v1.1.0 — correctness sampling is now decided mechanically** (not an anchor change): the ★1–★5
  thresholds (pass rate <50% / 50–79% / ≥80% / ≥90% / all pass) are unchanged word for word; what
  changed is **which claims get sampled** — from the LLM picking freely each round to consuming the
  stable ordering in `inventory.claim_candidates`, re-verifying the existing ledger first. When
  comparing correctness scores across v1.1.0: the old scores' samples are not reproducible, the new
  ones are. The report also gains "cumulative coverage" (report-only, does not affect the rating).
- **v1.0.0 — added a sixth dimension, economy** (**breaking, the rubric's structure changed**):
  fixed cost and pollution surface were promoted from report-only to a rated dimension. A
  `history.jsonl` from the five-dimension era has no `economy` key, **overall scores are not
  comparable across v1.0.0**, and affected repos should restart their convergence rounds from a new
  baseline (old records are kept; `report` draws a breakpoint there). The ★1–★5 anchor text of the
  **five existing dimensions** is unchanged word for word — what is incomparable is "did it meet
  targets" and the set of dimensions, not the ruler of any individual dimension.
- **v0.5.0 — consistency judgement widened across carriers** (not an anchor change): the scope went
  from "within docs" to including placement and duplication between docs and code comments/specs.
  A repo previously at ★5 may be marked down because a code comment and a doc each expand the same
  fact. The ★1–★5 anchor text is untouched, but a report comparing consistency across v0.5.0 must
  note that the scope widened — the same class of change as 0.2.0 moving completeness onto a
  coverage-based mechanical basis.
- **0.2.0 — completeness moved onto coverage.mjs as its mechanical basis** (not an anchor change):
  it was previously a pure LLM comparison.
- **0.6.1 — fixed false positives in linkage broken anchors** (not an anchor change): once
  `githubSlug()` was aligned character for character with GitHub, CJK headings no longer produced
  approximation errors, and `cjk_uncertain` was demoted from an exception ("confirm by hand before
  counting it") to an advisory field; broken anchors always cost stars. Linkage scores from before
  0.6.1 may be depressed by false positives.
- **The graduation-only note on freshness ★5**: it only explains the reachability cap inside the
  loop (Blocker #3, do not touch CI). It changes none of the ★1–★5 thresholds and does not affect
  the comparability of historical scores.

</details>
