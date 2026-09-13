# improve / loop — convergence rounds

> **Last updated:** 2026-09-13

`improve` = run one round and stop; `loop` = run repeatedly until a stop condition. The process is exactly the same.

## Preconditions (blockers)

1. No `.docgrad.yml` → stop, point to `/docgrad init`.
2. Haven't read [rubric.md](rubric.md) yet → read it first.
3. Target repo's working tree has uncommitted changes (not produced by docgrad) → stop, ask the user to deal with it before running.

## Branch discipline

- Always work on the `docgrad/converge` branch: doesn't exist → create it from the current branch; already exists → checkout and continue (resumable after interruption).
- Only commit docs changes and `.docgrad/` state files — "docs changes" = files covered by `.docgrad.yml`'s `docs_dirs`/`docs_files`/
  `entry_files`, **not source code files** (including their comments). **Never touch the target repo's CI config.**
- Branch isolation lets the user review the whole batch before merging; one commit per round guarantees you can roll back.

## Steps in each round

1. **Score**: run a full evaluation per [audit.md](audit.md) (scripts + LLM), producing this round's scorecard.
2. **Pick a dimension**: take the lowest-scoring dimension; on a tie → take whichever comes first in rubric order
   (completeness → correctness → freshness → linkage → consistency → economy).
   A dimension already judged to have hit its **design ceiling** (see stop conditions) is excluded from selection; take the next-lowest instead.
   **Fix only this one dimension per round** — convergence is not a rewrite, and changing everything halfway leaves contradictions behind. There are two exceptions, and both must be stated in the report:

   - **The trivial-fix allowlist**: dead-link fixes, folding orphans into the index, typo-level consistency — **fixable on the side in any round**,
     just list them in the commit message. Reason: these three categories have full mechanical verification (re-running the scripts tells you instantly), so there's no
     risk of "change it halfway and leave a contradiction" — the rule blocking them would just push a zero-risk fix to next round for no reason.
   - **Small-corpus mode**: when `inventory.totals.tokens_est` < 10,000 or `totals.files` < 5,
     multiple dimensions per round are allowed; note in the report "small-corpus mode: fixing N dimensions this round." Reason: dream-calm-true has only two
     documents, and one-dimension-per-round there is pure round overhead — its own scorecard notes that "the two install methods could be unified,
     but fixing it would violate one-dimension-per-round," pushing out a two-line, zero-risk fix for no reason.

   Neither exception exempts step 4's verification: if any dimension drops, revert regardless.
   When **consistency** is picked, break it down one level further: fix only one category of deduction per round, ordered `[Contradiction]` → `[Duplication]` → `[Placement]`
   (contradictions feed the agent wrong facts and do the most damage; duplication is a breeding ground for contradictions; placement is only about retrieval efficiency).
   Moving information's placement can touch code comments/specs, which is riskier than changing docs — it goes last, and that round must not also fix another category.
3. **Fix**: generate and execute focused changes for the dimension's deductions, one at a time:
   - Mechanical fixes go straight through: dead-link repair, folding orphans into the index, date backfilling — always use
     the real date from `git log -1 --format=%as -- <file>`, **fabricating a date is forbidden**.
   - Semantic fixes go through too, but must be listed in the commit message: merging redundant documents, rewriting a narrative to
     refer to the code instead, deleting files, writing missing documents.
   - **How to fix economy**: the only two mechanically viable paths are "move the entry file's content out and leave only a pointer" and "move WIP/
     historical baggage out of the corpus" (`exclude` or delete the file). The former is a move, not a cut — **the content must land inside `docs_dirs`
     and be reachable from the index**, otherwise completeness and linkage will drop together and the verification step will block it.
     **Deleting content that's still correct and still needed, just to lower the cost, is forbidden**; when "delete it" really is the only way left to bring the cost down,
     call it a plateau and hand the trade-off to the user — don't decide yourself which document to cut.
     If `entry_files`'s configuration itself is wrong (it lists a file that never enters the agent's context, or omits one that's required reading) → fix `.docgrad.yml`
     and say so explicitly in the commit message; this counts as a config fix, not score-farming. When a listed file is actually **conditionally** loaded,
     move it to `docs_files` instead (still in the corpus, doesn't count toward fixed cost) — **don't** just delete it, since deleting it would also drop completeness.
   - **The boundary for placement fixes**: only touch files within docs scope (entry file ↔ docs, docs ↔ docs moves go ahead as normal).
     Suggestions to move information into code comments or other source files are **never executed automatically** — that's outside the branch discipline of
     "only commit docs changes," and none of the five scripts verify code comments, so there'd be no way to confirm the change didn't break anything.
     Write these deductions into this round's report as a "recommend human handling" list and note them; if consistency then goes two rounds with no progress because of this,
     call it a **design ceiling**, not a plateau.
4. **Verify**: rerun the scripts and re-score the affected dimensions. Success = the target dimension goes up and no other dimension drops.
   Any dimension dropping → revert the change that caused the drop, and note it.
5. **Record and commit**:
   - Append one line to `.docgrad/history.jsonl` (create it if it doesn't exist). `docgrad_version`, `rubric_hash` and
     `corpus_hash` **must be copied straight from `inventory.mjs`'s output `docgrad` block** (all three live there), don't fill
     them in yourself:

     ```json
     {"round": 3, "date": "2026-07-12", "dimension": "linkage", "docgrad_version": "1.1.0", "rubric_hash": "b6e4f7f3", "corpus_hash": "684034d6", "scores": {"completeness": 4, "correctness": 3, "freshness": 4, "linkage": 4, "consistency": 4, "economy": 4}, "coverage": {"claims_verified": 23, "claims_total": 68}, "notes": "fixed 12 dead links; folded 2 orphans into the index"}
     ```

     The three version fields are for `report` to draw comparability breakpoints: when `rubric_hash` changes it means the ruler changed,
     and the scores before and after can't be compared directly; when `corpus_hash` changes it means the set of files being measured
     changed (`docs_dirs`/`docs_files`/`entry_files`/`exclude`/`index_file`/`exclude_untracked`), which moves `files_total`,
     `claims_total`, the freshness denominator and the pollution denominator at once — every dimension in that round is affected,
     not just one. **Write `corpus_hash` every round even when it hasn't moved**: `report` can only spot the change by comparing
     consecutive lines, so a round that omits it leaves the break undetectable. `corpus_hash` is `null` when the round ran without a
     config. Old records missing these fields are treated as unknown and don't block anything.

     A dimension judged **not measurable** (see the design-ceiling section below — currently only correctness, when the corpus
     holds no verifiable claims) is recorded as `null`, never as a number. `report` must render it as `n/a` and must not
     include it in any average; a guessed star would be indistinguishable from a measured one a few rounds later.
   - Append the claims verified this round to `.docgrad/ledger.jsonl` (create it if it doesn't exist). **Cumulative, append-only, never rewritten** —
     when re-verifying an old entry, append a new line (with the new `round`) rather than editing the old line, so you can still see when a given claim broke and when it got fixed:

     ```json
     {"claim_id": "docs/x.md:75", "round": 3, "doc": "docs/x.md", "line": 75, "claim": "Routing is defined in src/router.ts", "verify": "Read src/router.ts", "result": "pass", "verified_at": "2026-07-12"}
     ```

     `claim_id` = `<path>:<line>`. When document reshuffling causes the line number to drift, keep using the old `claim_id` based on the claim's content
     and add `"moved_from": "<old id>"` on that line — don't treat it as a new claim, that would inflate cumulative coverage artificially.
   - Overwrite `.docgrad/scorecard-latest.md` (the full scorecard text from audit.md).
   - Commit. Write the message in the target repo's own language — the `language:` field in its
     `.docgrad.yml`, falling back to the language its recent commits are written in. The structure
     below is fixed; only the prose is translated:

     ```
     docs(docgrad): round N convergence — <dimension> ★x→★y

     Semantic changes:
     - merged a.md into b.md (overlapping topic)
     - …(omit this block when there are none)

     scorecard: completeness★x correctness★x freshness★x linkage★x consistency★x economy★x
     ledger: cumulative coverage m/N (a newly verified this round, b re-verified)
     ```

## Dimension cap: the design ceiling

When a dimension's next star anchor falls inside a Blocker no-go zone → that dimension is judged "converged within docgrad's scope (capped at ★x)": it's no longer eligible for dimension selection, it counts as targets-met when checking whether targets are met, and it gets called out with its reason in the final report and graduation recommendation. **This does not stop the loop** — it just removes that dimension from the working set.

There are currently three cases. The first two share a cause — both ★5 anchors require a mechanical
gate, and Blocker #3 explicitly says not to touch the target repo's CI — and both only get hit when
that dimension's target is set to 5, so the default target ★4 is unaffected:

- **Freshness ★5**: requires "a mechanical gate enforcing update-alongside-change in the same MR" → capped at ★4 within the loop.
- **Economy ★5**: requires "a mechanical gate enforcing the entry file's token budget" → capped at ★4 within the loop.

The third has a different cause but the same handling — the dimension cannot be *measured*, so there
is no star to raise:

- **Correctness, not measurable**: the round's verified set is empty because the corpus contains no
  verifiable claims at all (`claims_total: 0`, no ledger entries). Every correctness anchor is
  phrased as a pass rate, and a pass rate over zero claims is undefined, so the dimension is reported
  as `n/a (not measurable)` rather than rated — see [audit.md](audit.md) §3. Correctness (claim ledger).
  It counts as met for the targets check and leaves the working set, exactly like the two above.
  **Unlike them, this one is fixable — just not by the correctness dimension.** The report must say
  so: the corpus needs claims anchored to real code coordinates before correctness can be measured,
  which is work the completeness and placement dimensions own.

**The difference from plateau**: plateau = fixable, but these two rounds produced no gains, and there's still a chance on the next run; design ceiling = unreachable by design,
no number of further rounds will move it. Judging it as plateau would mislead the report into telling the user "try running a few more rounds," so check for the ceiling before checking for plateau.

## Stop conditions (loop; any one of them ends it)

- ✅ **Targets met**: every dimension is either "≥ the target in `.docgrad.yml`" or "already judged to have hit the design ceiling" → final report + graduation recommendation (see below).
- ⏸ **Plateau**: two consecutive rounds where no dimension's score improves at all (dimensions already at the ceiling don't count) → a plateau report: which dimension is stuck on which deductions, and
  why docgrad can't fix it (e.g., needs domain knowledge to be written in, needs a human to decide a trade-off).
- ⏸ **Needs human decision**: two documents are mutually exclusive and the code can't arbitrate, or the fix involves a product decision → list the options
  (A/B, with each one's consequences and a recommendation), pause and wait for the user's decision before continuing.

`improve` just stops once its one round finishes, outputting this round's scorecard and a diff summary.

## Graduation (do it when targets are met, do not just recommend it)

**Why this section has a deliverable**: convergence without a gate decays naturally. On the **very day** oikos graduated, a new orphan appeared
(`utm-convention.md`) along with files missing `last_updated`, and coverage went 95.1% → 90.7%; two months later
it was still sitting there, unreclaimed. A prose-style "we recommend you build your own CI" has no deliverable, so nobody acts on it.

Blocker #3's "don't touch CI" means **don't automatically modify the user's CI**, not that you can't produce CI materials.

Do two things at graduation:

1. **Produce it, but don't install it**. Copy the two files from `$SKILL_DIR/templates/` into the target repo's
   `.docgrad/graduation/`, and tune `THRESHOLDS` to the repo's actual current state (the current values become the thresholds,
   so the gate is green from day one and can only be tightened afterward):

   ```bash
   mkdir -p .docgrad/graduation
   cp "$SKILL_DIR/templates/docs-gate.mjs" "$SKILL_DIR/templates/docs-gate.yml" .docgrad/graduation/
   ```

   **Never write into `.github/`**, and never modify any existing CI configuration.

2. **Always attach this passage to the report** (fill in the actual path values):

   > `.docgrad/graduation/docs-gate.mjs` and `docs-gate.yml` have been produced, **not installed**.
   > To enable: put the `.mjs` in `.github/scripts/` and the `.yml` in `.github/workflows/`;
   > both already have their thresholds set to this repo's current state. The gate only blocks dead links/broken anchors/orphans/freshness coverage/
   > entry-file token budget — how strict to be is the team's call, docgrad doesn't decide that for you.
   >
   > Dead links and formatting can also be handled with more mature off-the-shelf tools instead (lychee or markdown-link-check, markdownlint,
   > Vale). docgrad's scripts add differentiated value in orphans/reachability and entry-file token budget — these two are
   > measurements specific to "documentation as agent context" that a typical docs linter doesn't do.

When a dimension is capped by the design ceiling, this section must call it out: the only way for that dimension to gain another star is through this gate
(freshness ★5 = "docs updated in the same MR as the code"; economy ★5 = "entry-file token budget"),
and it must state the current cap.

## Exit for findings outside docgrad's remit

docgrad doesn't touch code or CI, but the scoring process is bound to run into that stuff (oikos round 3 caught
`lib/supabase/server.ts`'s docstring going stale, and all it could do was write it into notes — two months later it was still sitting there).
Nothing tracks free-text notes, so every round was producing loose ends that never got picked up.

When a finding falls outside docgrad's remit, append one line to `.docgrad/out-of-scope.jsonl` (create it if it doesn't exist, append-only, never rewritten):

```json
{"round": 3, "kind": "code-comment", "path": "lib/supabase/server.ts", "line": 42, "claim": "the docstring still says 'without an Auth API round-trip', which stopped being true as of v1.0.2", "suggested_action": "fix the docstring; docgrad doesn't touch code", "status": "open"}
```

- `kind`: `code-comment`/`ci`/`product-decision`/`other`.
- If a later round confirms it's been handled → append the same entry but with `status: "resolved"`, don't edit the old line.
- **The final report must list every `status: open` item and its count**, not just leave it in that round's notes.
- If the user asks, you may open tickets one by one with `gh issue create` on their behalf — **only after explicit confirmation**.
