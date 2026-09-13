# audit — one full scoring pass

> **Last updated:** 2026-09-13

Precondition (blocker): the target repo root must have `.docgrad.yml`; if not → stop, point to `/docgrad init`.
This process **does not modify any file** and writes no state — pure report. Read [rubric.md](rubric.md) before scoring.

## Contents

- [Step 1. Run the mechanical scripts](#1-run-the-mechanical-scripts)
- [Step 2. Completeness](#2-completeness)
- [Step 3. Correctness (claim ledger)](#3-correctness-claim-ledger)
- [Step 4/5. Freshness / Linkage](#4-freshness--5-linkage)
- [Step 6. Consistency (across documents and carriers)](#6-consistency-across-documents-and-carriers)
- [Step 7. Economy](#7-economy)
- [Step 8. Token economy report](#8-token-economy-report)
- [Step 9. Emit the scorecard](#9-emit-the-scorecard)
- [Scoped audit (limited scope / single dimension)](#scoped-audit-limited-scope--single-dimension)

If the user specifies a scope (directory / glob / topic) or a single dimension → first read [§Scoped audit](#scoped-audit-limited-scope--single-dimension) at the end of this file, then come back and run the steps below.

## Steps

### 1. Run the mechanical scripts

`SKILL_DIR` = this skill's install directory (one level above this file). Run from the target repo root:

```bash
node "$SKILL_DIR/scripts/inventory.mjs" --root .
node "$SKILL_DIR/scripts/links.mjs" --root .
node "$SKILL_DIR/scripts/freshness.mjs" --root .
node "$SKILL_DIR/scripts/coverage.mjs" --root .
node "$SKILL_DIR/scripts/retrieval.mjs" --root .
```

Consume all five JSON outputs in full; don't truncate with head/grep/jq. If any script exits non-zero → stop and report stderr.

### 2. Completeness

1. First consume the coverage.mjs output: list `undocumented` and `drifted` areas directly as gaps
   (undocumented = no authoritative document at all; drifted = code has changed but docs haven't caught up);
   each area's `mentioned_by` can be manually rechecked for false positives (near-matched paths, incidental mentions).
   When `src_dirs` is not configured (the output carries a note), this step degrades and falls back entirely to the LLM cross-check below.
2. Then do an LLM top-level supplementary check: list the repo's actual modules/domains (top-level src structure, main subsystems,
   deployment and test infrastructure), and cross-check against the inventory file list to catch gaps coverage can't see (subsystem-level granularity, deployment/test infrastructure with no corresponding src directory).
3. Assign a star rating against the rubric's completeness anchors, and note down the list of deductions.

### 3. Correctness (claim ledger)

**Sampling is not yours to decide freely** — that's exactly what caused oikos's consistency rating to drop ★4→★2 on re-verification after its 2026-07-13 graduation (`transactions-design.md`'s balance sign was the opposite of the code, and "the first four rounds of sampling never covered it"). What gets sampled is decided by the script; you're only responsible for verifying it.

**`correctness_sample` is the number of claims drawn *new* this round, not the number of claims verified this round.**
Re-verification is a separate budget and never eats into it. A round's verified set is exactly:

```
every outstanding fail/stale          (no cap)
+ up to floor(correctness_sample / 2) least-recently-verified passes
+ correctness_sample new draws        (never reduced by the two lines above)
```

Steps 1–3 below build those three parts in order.

1. **Re-verify every outstanding `fail` and `stale` entry — no cap.** If the target repo has `.docgrad/ledger.jsonl` → read it in and
   **collapse it to the latest row per `claim_id` first** (the highest `round`; the ledger is append-only, so an old `fail` row that a later
   round already recorded as `pass` is *not* outstanding). Every claim whose latest row is `fail` or `stale` gets re-verified, however many there are.
   Fixed ones get recorded as `pass`; still-wrong ones keep their original verdict and go into the deductions list.
   Why no cap: these entries decide whether the round's pass rate is honest. Letting them drop out of the denominator would make a repo's
   correctness score *improve* as its documentation gets worse. In a converging repo this count trends to zero on its own, so it costs nothing in steady state.
   > No ledger (first run) → skip steps 1 and 2 and go straight to drawing new claims.
2. **Re-verify the `floor(correctness_sample / 2)` least-recently-verified `pass` entries** — not half of all passes.
   Re-verifying a claim that already passed is worth less than sampling one that has never been checked, and it is the growing pass set
   that used to crowd out new draws. Capping it at half a sample keeps a fixed, small cost no matter how large the ledger grows.
   **"Least recently verified" is read off the collapsed ledger's `round` field**, ascending; ties break on `verified_at` ascending, then on
   `claim_id` ascending. (`round` is the primary key because it is monotonic within a repo and stays unambiguous when two rounds run on the
   same date; `verified_at` alone cannot separate them. The `claim_id` tiebreak is what makes two independent runs pick the same set.)
   Take the first `min(floor(correctness_sample / 2), number of pass entries)` of that ordering.
3. **Draw `correctness_sample` new claims** — and do not let steps 1 and 2 reduce that number.
   Consume `inventory.mjs`'s `claim_candidates` (already stably sorted by "ref count → path → line",
   same order every time for the same corpus). Take candidates that **haven't entered the ledger yet**, front to back, until
   you have `correctness_sample` of them; at most 2 per document (skip any over that quota and keep taking from further down).
   Cumulative coverage therefore grows by `correctness_sample` every round, with no ceiling, until the pool runs out.
   **When fewer than `correctness_sample` unseen candidates remain, the round draws what exists — possibly zero — and the report states the shortfall**,
   naming which of the two causes it was: the candidate pool is exhausted (every candidate has entered the ledger), or the remaining unseen
   candidates all sit in documents that already hit this round's 2-per-document quota. Write it as
   `drew 7 of 12 (pool exhausted: 335/335 candidates already in the ledger)`. A round with no new draws is not an error — it means the corpus is
   fully covered; steps 1 and 2 still run and the pass rate is still computed over whatever was verified.
   > `claim_candidates`'s population = `totals.claims_total` (non-heading lines outside fences that have a code coordinate).
   > Purely descriptive paragraphs have no coordinate to sample and were never meant to enter the ledger — consistent with the old
   > "don't sample pure narrative" rule, the only difference being the script decides it now instead of re-interpreting it every round.
4. **Verify each one against the code** (actually Read/Grep it, don't go from memory).
   **The scope of verification is the candidate's whole `section_lines` span, not just that one line** — contradictions are often written in the **sentence next to** the anchor line:
   oikos's balance sign issue sat in the sentence right after "settlement is handled by `src/balance.ts › settle()`",
   and looking only at the anchor line would have missed the whole thing. Any sentence in the span that disagrees with the code gets recorded `fail`, with `claim_id` pointing at **the line that's wrong**.
   Record into the ledger table:

   | # | file:line | claim | verification method | result |
   |---|---|---|---|---|
   | 1 | docs/x.md:75 | "Routing is defined in `src/router.ts`" | Read src/router.ts | pass / fail / stale |

5. **Calculate two numbers, and put both in the report**:
   - **Pass rate** = pass ÷ total verified this round (all three parts of the verified set: outstanding fail/stale, re-verified passes, new draws)
     → assign a star rating against the rubric's correctness anchors.
   - **Cumulative coverage** = distinct claims in the ledger ÷ `totals.claims_total` → write it in the report as
     `Correctness ★4 (pass rate 8/8, cumulative coverage 23/68 = 34%)`.
     **A star rating alone means nothing** — the reader needs to see the sample size it's built on.
6. Record the nature of the error (detail vs. mechanism) into the deductions too.

**Worked example** (`correctness_sample: 12`, oikos's 335 candidates, a ledger holding 12 distinct claims — all `pass` — at the start of round 8).
Assume round 9's new draws turn up 3 failures and the next round's fixes repair 2 of them:

| Round | Distinct at start | fail/stale re-verified | pass re-verified | New draws | Verified this round | Distinct at end |
|---|---|---|---|---|---|---|
| 8 | 12 | 0 | 6 | 12 | 18 | 24 |
| 9 | 24 | 0 | 6 | 12 | 18 | 36 |
| 10 | 36 | 3 | 6 | 12 | 21 | 48 |
| 11 | 48 | 1 | 6 | 12 | 19 | 60 |
| 12 | 60 | 0 | 6 | 12 | 18 | 72 |

Read off it: the "distinct at end" column grows by exactly `correctness_sample` every round and never converges — the pass re-verification is a
fixed 6 whatever the ledger size, so the old fixed point (re-verification growing until it consumed the whole budget, freezing oikos at
23/335 ≈ 7%) does not exist. Full coverage of 335 candidates now takes ⌈335/12⌉ = 28 rounds instead of never. Failures widen the verified set
(rounds 10 and 11 verify 21 and 19 claims) instead of displacing new draws — under the old rule, 3 failures against a ledger of 18 passes left
zero new draws, so the sampling stopped expanding exactly when the documentation most needed it.

> **Empty sample: correctness is reported as not measurable, not as a star.** The trigger is mechanical: the round's verified set is empty —
> no outstanding `fail`/`stale`, no `pass` entries in the ledger, and no candidates to draw (`totals.claims_total: 0`). This is the normal state
> for a library repo whose documentation describes an API rather than file paths. A pass rate over zero claims is undefined, so every ★1–★5
> anchor here is inapplicable; picking one anyway is how four independent runs on the same fixture produced ★3, ★3, ★1 and ★2. In that case:
> - Write `n/a` in the rating column, with `(not measurable — 0 verifiable claims in the corpus)` as the deduction text. **Do not** give a star:
>   not ★1 (nothing was found wrong), not ★3, not the target value.
> - Treat it like a design ceiling for the targets check: the dimension counts as met and is excluded from "pick the lowest dimension"
>   (see [improve.md](improve.md) §Dimension cap: the design ceiling).
> - **The report must state the finding**, because it is itself the thing worth acting on: the corpus contains no claim carrying a code
>   coordinate, so nothing in it can be mechanically checked against the code and correctness can never be measured until that changes.
>   Put the recommendation — anchor claims to real paths/symbols so they become verifiable — under "Suggested next steps" even though the
>   dimension carries no star.
>
> A corpus with claims but an unlucky round is *not* this case: if `claims_total > 0`, the verified set cannot be empty (there is always
> something to draw), so the rating proceeds normally.

> **audit writes nothing to disk**: this process **reads** the ledger but never writes it. The ledger is only written by `improve`/`loop`
> (see [improve.md](improve.md) step 5) — consistent with the ironclad rule that "audit is pure report".

### 4. Freshness / 5. Linkage

Assign star ratings directly against the rubric anchors using the freshness.mjs / links.mjs output.

For freshness, also check `date_concentration` (doesn't affect the star rating, but **must be written in the report**): a high `max_same_day_ratio` means the date signal is clustered on a single day, usually the trace of a bulk backfill — these files will age together and go stale together, and no matter how high `coverage_ratio` is, it can't tell you "which document has genuinely gone unmaintained for a long time." oikos measured 0.68 in practice (28/41 files stuck on the backfill day). Write it in the report as "coverage 95%, but 68% of the dates cluster on 2026-07-13, limiting the signal's discriminating power." Note it can't distinguish "backfill" from "this batch of files really did change at the same time" — it only flags, it doesn't rule.

Count every broken anchor from links: since 0.6.1 the slug algorithm matches GitHub character-for-character (spaces to dashes one by one, underscores inside words kept, explicit `<a id>` tags included in the index), so CJK headings no longer have approximation error. `cjk_uncertain` is kept only as a hint field, **not** a reason to skip verification.

### 6. Consistency (across documents and carriers)

Read [placement.md](placement.md) first — the rules for judging placement and duplication live there.

1. **Contradictions**: pick 3-5 key factual topics (architecture layering, state machines, deployment method, data model, …), compare claims across documents, and arbitrate contradictions with the code.
2. **Duplication**: for each topic, trace once more into the code comments/spec — who is the authority on this topic? Is there a second, independently-elaborated account of it?
   In practice: grep the comment blocks (`//`, `#`, `/** */`, docstrings) for the topic's key symbols/paths, and look for a definitional account that's elaborated separately from the docs. A summary + link doesn't count as duplication (the exception in placement.md).
3. **Placement**: sample 2-3 "current conclusions" and check where their grounds live (placement.md rule 4) — a spec that states a conclusion with no grounds, or grounds that only live in an issue → record a placement deduction. Also check against the three trade-off axes for anything placed in the wrong carrier (e.g., detail only needed when touching a particular module written into the entry file).
4. Every deduction is tagged with a category: `[contradiction]`/`[duplication]`/`[placement]`; the latter two must fill in all four columns placement.md requires
   (information / current placement / suggested placement / which axis is the reason) — don't raise a suggestion with a missing column.
5. Assign a star rating against the rubric's consistency anchors. **Only judge placement and duplication, never comment quality** — see the boundary in
   [design.md](../docs/design.md) §Positioning and boundaries.

### 7. Economy

Assign a star rating directly against the rubric's economy anchors using `inventory.mjs`'s `entry_cost.tokens_est` (fixed cost) and `pollution.ratio` (pollution surface) — **fully mechanical, no LLM judgment involved**. Two things must always be checked:

1. Whether `entry_cost.files` is really loaded on every task. Listing a human-only landing page (like the `README.md` used on GitHub) in `entry_files` inflates the fixed cost; conversely, a file the agent must read every time but that isn't listed under-reports it.
   Finding a mismatch between the config and reality → record it as a deduction and suggest fixing `.docgrad.yml`, **don't** change the config yourself and then score.
   - **Conditionally-required files** (an entry file that says "read `DESIGN.md` before touching the UI") don't count as always-loaded:
     suggest moving them to `docs_files` instead — they still enter the corpus and the other five dimensions, but don't count toward the fixed cost (see [init.md](init.md) questionnaire item 3).
2. When pollution surface ≥ 10%, this dimension is capped at ★3 (the rubric's downgrade rule), even if the fixed cost is low.
3. **Check `inventory.untracked.count` before you write the rating down** — the corpus is collected off the filesystem, not out of git, so this rating can depend on whose checkout it was run in:
   - **Non-zero** → the run collected N local files git does not track (`untracked.files` lists them, `untracked.tokens_est` is what they weigh). The pollution ratio and the token totals are **checkout-bound: another machine on the same commit gets a different number, and possibly a different star**. The scorecard must say so, quoting the count and token weight, and recommend `exclude_untracked: true` in `.docgrad.yml` to measure the clean-checkout corpus instead (see [init.md](init.md) questionnaire item 6). `inventory.pollution.note` carries the same warning when any *collected* file is untracked — pass it through, don't paraphrase it away.
   - **`null`** → git was unavailable or this is not a git working tree (`untracked.note` says which), so tracked and untracked files cannot be told apart and the check **could not run at all**. State that in the report; `null` is not zero, and an unrun check must not be reported as a clean one.
   - **Zero** → the collected corpus is exactly what the commit contains; nothing to note.

### 8. Token economy report

Expand on the details of fixed cost and pollution surface per rubric.md's "Token economy report" section, with a break-even interpretation attached.
Report `inventory.untracked` on the line right after the pollution surface (count, token weight, and the paths from `untracked.files` when there are few enough to name; `null` = the check could not run, see step 7) — it is the qualifier on the pollution number, so it belongs next to it rather than in a footnote.

Marginal cost: when `.docgrad.yml` has `scenarios:` set (a list of representative code paths), consume `retrieval.mjs`'s
`scenarios[]` output directly — list `marginal_tokens`/`max_depth`/`fan_in`/`code_pointer` for each entry, and use
`churn_commits` to sort and call out the one that "taxes the most." When `scenarios:` isn't set, fall back to the old method: use `.docgrad.yml`'s
`scenario` (singular) and have the LLM simulate the required-reading path along the index/routing rules.

Also include a "Traceability" subsection (report-only, not rated, see rubric.md's section of the same name):
`retrieval.mjs`'s `code_pointer_ratio` (list the low-ratio areas — meaning that once code changes there's no path back to the spec),
`index_hotness` (call it out when `ratio` is noticeably high, with `top5` attached); files whose `inventory.mjs` per-file `structure.rules`
have a noticeably long `median_chars`/`p90_chars` or a noticeably low `anchored_ratio` — suggest splitting into a contract layer and a detail layer.

### 9. Emit the scorecard

```markdown
# docgrad scorecard — <repo> @ <YYYY-MM-DD>

| Dimension | Rating | Target | Main deductions |
|---|---|---|---|
| Completeness | ★x | ★y | … |
| Correctness | ★x | ★y | …(pass rate n/N, cumulative coverage m/total = x%; `n/a` when the corpus has 0 verifiable claims) |
| Freshness | ★x | ★y | …(date concentration x%, call it out if high) |
| Linkage | ★x | ★y | … |
| Consistency | ★x | ★y | …(deductions tagged `[contradiction]`/`[duplication]`/`[placement]`) |
| Economy | ★x | ★y | …(fixed cost N tokens, pollution surface x%; add "N untracked files — ratio is checkout-bound" when `untracked.count` is non-zero, "untracked not checked (no git)" when it is `null`) |

## Token economy (not rated)
- Fixed cost: ~N tokens (entry_files: …) — already counted in economy
- Marginal cost: with scenarios, list each one (scenario "path": ~N tokens, max_depth N hops, fan_in N,
  code_pointer yes/no, churn_commits N — call out the one that taxes the most); without scenarios, fall back to scenario "…" LLM
  simulation: ~N tokens, required-reading path a.md → b.md → …
- Pollution surface: x% (exclude: …) — already counted in economy
- Untracked files in the corpus: N files / ~M tokens (…paths) — the ratio above is checkout-bound, another machine on this
  commit may rate economy differently; `exclude_untracked: true` measures the clean-checkout corpus instead.
  Write `0 — corpus matches the commit` when there are none, and `not checked (no git)` when `untracked.count` is `null`
- Interpretation: …

### Traceability (report-only)
- code_pointer_ratio: x% (below-average areas: …)
- index_hotness: ratio N (top5: …)
- Files with long structure.rules / low anchored ratio: …

## Outside docgrad's remit
When the target repo has `.docgrad/out-of-scope.jsonl`, list all `status: open` items and their count
(see [improve.md](improve.md) §Exit for findings outside docgrad's remit); omit this section entirely if the file doesn't exist.

## Suggested next steps
Lowest-scoring dimension = <dimension> (ties broken by rubric order). Deductions:
1. …
2. …
(to start converging, run /docgrad improve or /docgrad loop)
```

## Scoped audit (limited scope / single dimension)

**Trigger**: the user's input carries a scope (directory, glob, or a topic description like "infra-related docs") or a dimension
(`--dim freshness`, "just score completeness").

**Scope translation**: translate a topic description into a concrete glob first (use the inventory's file list to pick out relevant files), and
**list the actual `--include` value used** in the report header — the user needs to see what you interpreted "infra-related" as. If you can't translate it, ask; don't guess.

**Ironclad rule: pure report, writes nothing to disk.** A scoped result never writes `.docgrad/scorecard-latest.md`, never appends to
`.docgrad/history.jsonl` — history's cross-round comparability only recognizes full audits; mixing in scoped scores would distort the trend.
Refuse even if the user asks to "log it while you're at it" — suggest running a full `audit` or `improve` instead.

**How to run it**: pass the `--include <glob>` flag (repeatable or comma-separated) to the three scripts that accept it (inventory/links/freshness);
`coverage.mjs`/`retrieval.mjs` deliberately don't take it and always run in full. With `--dim`, run only the scripts that dimension needs
(cross-reference [rubric.md](rubric.md) §Mechanical signal → dimension map), skip the rest.

**How each dimension behaves under scope** (skip this and you get a misleading star rating):

| Dimension | Scoped behavior |
|---|---|
| Completeness | `coverage.mjs` always cross-checks in full (`--include` deliberately has no effect on it) — shrink the docs side and mentions outside the scope get misjudged as undocumented. The LLM supplementary check is limited to domains inside the scope. |
| Correctness | the claim ledger samples only from documents inside the scope (`claim_candidates` has already been narrowed to the scope by `--include`); `correctness_sample` — the number of *new* draws — may be scaled down proportionally to file count, and the actual number drawn gets written into the report. Cumulative coverage **must not be reported** — the denominator `claims_total` has been narrowed by scope and doesn't mean the same thing as a full report's coverage. The existing ledger is still read and still re-verified, but **not written back**. |
| Freshness | usable as-is (per-file judgment, unaffected by scope). |
| Linkage | only dead links/broken anchors count; the script returns `null` for orphans and reachable ratio — reachability is a full-index concept and gets distorted the moment the scope shrinks. Write "not applicable" in the report; **don't** give a ★1 because of it. |
| Consistency | cross-document comparison is limited to inside the scope; when the other half of a contradiction falls outside the scope, record it as "needs a full audit to confirm." |
| Economy | **must not be star-rated when scoped**. Fixed cost is a full-corpus concept over entry_files, and pollution surface is a proportion of the whole corpus — both get distorted the moment the scope shrinks. Write "not applicable (needs a full audit)" in the report; **don't** give a ★1 because of it — same as linkage's orphans/reachable ratio. |
| Token economy report | report only tokens inside the scope, and note that the scoped value can't be compared to a full report's; `retrieval.mjs` doesn't accept `--include` (same reason as coverage.mjs, see its `note`) — marginal cost/traceability are reported in full. |

**Report header** (replaces the full scorecard's title line):

```markdown
# docgrad scoped report — <repo> @ <YYYY-MM-DD>

> scope: `docs/infra/**` (from "infra-related docs") | dimension: all | **pure report, nothing written to `.docgrad/`**
```

With `--dim`, the scorecard lists only that one dimension's row; "Suggested next steps" still gives that dimension's deductions — dimensions that weren't scored get no star rating and no blank row.
