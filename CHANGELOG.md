# Changelog

Version authority is `version` in [.claude-plugin/plugin.json](.claude-plugin/plugin.json); this file records changes per version.
For version-number semantics (semver, docgrad-specific) see [docs/how-to.md](docs/how-to.md) §Cut a release.

## 1.6.0 — 2026-09-13

Five measurement defects fixed (#40 #41 #42 #44 #45), plus two statements the tool was making about
its own behaviour that turned out to be false. **No ★1-★5 threshold moved and no dimension changed**;
`rubric_hash` moves to `f0ce7d6a` because the Correctness and Economy measurement prose changed.

**What this version asks of you.** Three things, and a patch-level version number would have hidden
all of them:

1. **If you have a `.docgrad/ledger.jsonl`, its keys change.** `claim_id` was `<path>:<line>`; it is
   now `claim_hash`, a content hash the scripts hand you. Existing rows carry a `claim` field, so
   the hashes can be back-computed — the recipe is in `reference/improve.md`. Until you migrate, a
   round that re-verifies old entries will not match them up.
2. **The claim-candidate order reshuffles once.** `refs` now counts API-shaped references as well as
   path-shaped ones, so the ranking changes. Sampling stays fully deterministic; it is the
   continuity with an existing ledger's *draw order* that breaks, not its keys.
3. **Check `claim_population.truncated` before trusting cumulative coverage.** See the candidate
   window entry below — this one contradicts something v1.5.0 told you.

- **Fixed (#42) false broken anchors from underscores next to punctuation.** `extractHeadings()`
  stripped an underscore whenever *either* neighbour was non-alphanumeric, so `### cmd._args` slugged
  to `cmdargs` while GitHub produces `cmd_args` — and a link pointing at that heading was reported
  broken. Broken anchors always cost a star, and linkage is a fully mechanical dimension, so nothing
  prompts an agent to doubt the script: on a real repo the convergence loop **edited a file that had
  nothing wrong with it** to satisfy the false positive. An underscore is an emphasis delimiter only
  when it is part of a matching pair whose outer sides are non-alphanumeric; that is what is now
  implemented. 0.6.1 fixed a narrower case of the same bug and the fix was incomplete.
- **Fixed (#41) the ledger's primary key was destroyed by this tool's own core action.** `claim_id`
  keyed on `<path>:<line>`, and moving content out of an entry file is one of the two prescribed ways
  to improve economy. Every such move invalidates a batch of keys; the next round then reads the
  wrong line, records a false `fail`, and — because failures are re-verified without a cap — consumes
  the following round's new-draw budget. Measured: one round cut an entry file from 9,209 to 5,391
  tokens and invalidated three ledger keys. `claim_candidates` now carries `claim_hash` (sha256, 12
  hex chars) over the claim text with whitespace collapsed and nothing else normalised: a moved claim
  hashes the same, an **edited** claim hashes differently and is re-verified, which is correct.
- **Fixed (#40) on a library repo the correctness dimension had no mechanical basis at all.**
  `extractClaimLines()` recognised a claim by inline code shaped like a *file path*, and library
  documentation describes an *API*. Measured on `tj/commander.js`: baseline `claims_total` **0**, so
  the audit fell back to exactly the free-form sampling `reference/audit.md` forbids — the rule
  contradicted itself, because at zero population it offered no alternative. API-shaped spans now
  count, **guarded** by requiring every segment to exist as a symbol under `src_dirs`; with `src_dirs`
  unset the extension is inert and says so.
  - **Also disclosed: how much of the population docgrad wrote itself.** After that same repo's
    convergence loop wrote three documents in docgrad's house style, **all 26 candidates came from
    those three files and none from the seven pre-existing ones** — the correctness score rose while
    the repo's actual documentation debt was never sampled. `claim_population` and
    `totals.claims_docgrad_authored_ratio` now report this, and the audit must state it.
- **Fixed (#44) `exclude` carried two incompatible meanings and the pollution surface honoured only
  one.** "WIP I am ashamed of" and "content I deliberately scoped out of this run" are different
  claims about a repo and only the first should move a star. Measured on `tj/commander.js`: excluding
  translated mirrors that are graded as their own corpus charged **40.6% pollution** and capped
  economy at ★3 while the fixed cost was a perfect 0 — the one dimension five rounds of convergence
  could not move, blocked by field semantics rather than documentation quality. New list field
  **`out_of_scope:`** takes files out of the corpus without charging them, and its count and token
  total are reported on **every** run, empty or not, so the field cannot become a silent switch for
  zeroing your own pollution surface. A path in both fields stays charged (`exclude` wins), so a
  broad `out_of_scope` entry can never quietly cancel an `exclude` someone already wrote.
  **Default behaviour is unchanged and no existing rating moves**; a config that never uses the field
  hashes exactly as it did before the field existed.
- **Fixed (#45) four of the five scripts could not say which version produced their output.** Only
  `inventory.mjs` emitted the `docgrad` fingerprint. All five now do, in the same position — which
  matters most for `links.mjs`, whose `orphans` field changed shape in v1.5.0: the output most likely
  to be misread across versions was the one that could not identify itself.
- **Fixed: the claim-candidate window was a second, undocumented coverage ceiling — and v1.5.0 said
  it did not exist.** `inventory.mjs` emits only the top-ranked candidates, and a round can only draw
  from what is emitted; once a ledger covers them all, every later round draws zero while
  `claims_total` still reads in the hundreds. v1.5.0's rewritten sampling rule said coverage grows
  "with no ceiling" — true of the mechanism #37 changed, false of the pipeline. A repo under
  long-running convergence was three rounds from hitting it. The window is now the config field
  **`claim_candidates_cap`** (default 60, so nothing changes by default), and `claim_population`
  reports `cap` / `emitted` / `population` / `truncated` with instructions, so a truncated window can
  no longer read as a complete one.
- **Fixed: `coverage.mjs` reported a `scope` it does not honour.** It ignores `--include` and always
  compares the full corpus — its own `note` says so — yet it echoed the requested scope in the same
  object, while `retrieval.mjs`, which also ignores the flag, reports `null`. `scope` now means one
  thing across all five scripts: what the output actually covers, not what the caller asked for.
  `reference/audit.md` contradicted itself on this too and now matches the code.
- **Fixed: the `src_dirs`-unset note overstated what you lose.** It listed `a.b` as an API shape, but
  `a.b` is collected by the *path* matcher and keeps producing candidates with or without `src_dirs`.

## 1.5.0 — 2026-09-13

The repository's working language becomes English, `case-studies/` is added, and five measurement
defects are fixed (#35-#39). **No ★1-★5 threshold moved and the set of dimensions is unchanged**, but
`reference/rubric.md` did change in substance as well as in language, so `rubric_hash` moves and
`report` draws a comparability break here. A second break signal, `corpus_hash`, is introduced. Read
the comparability entry below before deciding what either break means for your history.

- **Changed (language) the whole repo is now English**: `SKILL.md`, all five files under
  `reference/`, `docs/design.md`, `docs/how-to.md`, `evals/` prompts and grader criteria, this
  changelog, `NOTICE.md`, and the comments and test names under `scripts/`, `tests/` and
  `templates/`. `README.md` is English; the Traditional Chinese README is kept in full as
  [README.zh-TW.md](README.zh-TW.md). The skill's `description` keeps its Chinese trigger keywords,
  so `/docgrad` still fires on Chinese phrasing.
  - **Fixtures under `tests/fixtures/` and `evals/fixtures/` were deliberately left in Chinese.**
    They are frozen corpora: their byte and token counts are asserted in the unit tests and recorded
    as baselines in `evals/README.md`, and several of them exist specifically to exercise CJK
    behaviour (`githubSlug()` on CJK headings, CJK-aware token estimation). Translating them would
    silently invalidate the baselines that make the evals meaningful.
  - **Machine-readable strings that tests assert on** (`note` fields, thrown-error text) were
    translated together with their assertions, in the same change. 71/71 unit tests pass.
- **Changed (comparability) `rubric_hash` f46f90cc → 21e957e5.** Three things moved it, and they are
  not equally serious. (1) The file was translated, so the qualitative anchor text is now different
  prose. (2) #37 changed what `correctness_sample` means and added a rule for an unmeasurable
  correctness dimension. (3) #35's evidence about the pollution surface was added under Economy. What
  survived untouched: **every numeric threshold, every ★1-★5 band, and the dimension order that
  breaks ties**. On (1) the honest position is that the qualitative anchors *are* the ruler a model
  reads, and "the same meaning in another language" is an assertion nobody can mechanically check —
  so this is recorded as a **real** break rather than papered over with a hash alias. Consequences:
  - **Mechanical dimensions are unaffected**: linkage, economy, and the mechanical part of freshness
    are computed by scripts, and no model reads the rubric to produce them. Scores across this
    version are directly comparable.
  - **Judged dimensions** (completeness, correctness, consistency) were read off different text
    before and after. Treat a one-star difference across this boundary as unexplained.
  - **No baseline restart is required.** Unlike 1.0.0, the set of dimensions and every threshold are
    unchanged, so the history stays meaningful; `report` draws the break line and you decide.
  - A structural hash — over the thresholds and the anchor ordering rather than the file bytes —
    would distinguish a translation from a real rubric change and remove this class of false break
    entirely. Not implemented; it is in the repo's open issues.
- **Changed (instruction) the convergence commit message is no longer hard-coded to Traditional
  Chinese**: `reference/improve.md` now says to write it in the target repo's own language, taken
  from `language:` in its `.docgrad.yml`. The message structure is unchanged.
- **Added `case-studies/`**: measured runs with the commands to reproduce them —
  [commander.js](case-studies/01-commander-js.md) (real agent token usage on one feature-design task,
  before and after convergence), [docgrad on itself](case-studies/02-docgrad-self.md) (nine real
  rounds, re-measured under one ruler), and [the eval fixtures](case-studies/03-fixtures.md)
  (is the star rating reproducible, and does the English rubric rate the same as the Chinese one).
  `case-studies/measure/token-usage.mjs` reads Claude Code's own subagent transcripts and reports
  real per-run token usage.
- **Added (README) agent-executable install and update instructions**: blocks you can paste into any
  Claude Code session to have the agent install, update, or go from zero to a first scorecard, plus
  docgrad's own always-on and on-invoke token cost as reported by `claude plugin details docgrad`.
- **Fixed (#39) `links.mjs` reported `orphans: []` when it had not computed orphans at all.**
  `reachable_ratio` correctly returned `null` under the same condition; `orphans` returned a value
  indistinguishable from "computed, and there are none". Measured on `tj/commander.js`: all seven of
  its documents were mutually unreachable, `index_file` was unset, and the JSON said zero orphans.
  `orphans` is now `null` whenever reachability was not computed — no `index_file`, or a scoped run —
  which is what `reference/audit.md` already claimed for scoped audits. **This changes the output
  type**: anything reading `orphans.length` must handle `null`. `templates/docs-gate.mjs` now treats
  "not computed" as its own violation rather than a silent pass.
- **Fixed (#38) `retrieval.mjs` counted entry files twice in `marginal_tokens`** when an entry file
  also sat on the index chain, and again when the same path was listed twice in `entry_files`. Every
  file is now counted once, which is what `reference/rubric.md` already specified — the code was
  wrong, not the spec. Report-only: **no star rating changes**, but scenarios whose entry file is
  reachable from the index will report a lower `marginal_tokens` than v1.4.0 did. `max_depth` was
  examined and left alone; it is a per-document maximum with no summation, so it could not
  double-count.
- **Fixed (#38) misconfigured fields failed silently.** `docs_files: PRODUCT.md` — a scalar where a
  list belongs — made `for…of` iterate the string character by character, every character failed
  `existsSync`, and **no files were collected with no error raised**; the only symptom was that
  `files_total` did not move. All list fields (`docs_dirs`, `docs_files`, `entry_files`, `exclude`,
  `src_dirs`, `scenarios`), the new boolean, and single-path fields (`index_file`) now throw an error
  that names the field and shows the correct form. `index_file: null` remains a legitimate answer; a
  key with nothing after the colon does not, because that parses as an empty mapping rather than as
  null. **Repos that have been quietly collecting nothing will now fail loudly** — that is the point.
- **Fixed (#37) the claim ledger's coverage had a hard ceiling, and worse documentation sampled
  less.** The old rule topped the round up to `correctness_sample` *total* verifications, so
  re-verification crowded out new draws; the fixed point sat at `2 × correctness_sample − 1` distinct
  claims and one real repo froze at 23 of 335 (≈7%) no matter how many rounds it ran. Because every
  `fail` was re-verified while only half the passes were, a repo with more failures got *fewer* new
  samples — the incentive pointed the wrong way. **`correctness_sample` now means new claims drawn
  per round, not claims verified per round.** A round verifies: every outstanding `fail`/`stale` (no
  cap, so the pass rate stays honest), up to `floor(correctness_sample / 2)` least-recently-verified
  passes, plus `correctness_sample` new draws that re-verification can no longer reduce. Coverage now
  grows by `correctness_sample` every round without a ceiling. **Comparability**: no threshold moved,
  but old pass rates were increasingly dominated by claims already known to be correct, so they read
  high — the more so the larger the ledger. Treat a pre-change ★4 as no stronger than a post-change
  ★4, never the reverse; coverage *trajectories* across this change are not comparable at all.
- **Added (#37) a rule for a correctness dimension that cannot be measured.** Every correctness anchor
  is phrased as a pass rate, and a pass rate over zero claims is undefined — which is the normal case
  for a library whose documentation describes an API rather than file paths. Four independent runs on
  the same fixture rated it ★3, ★3, ★1 and ★2, each defensibly. Correctness is now reported as
  `n/a (not measurable)`, recorded as `null` in `history.jsonl`, counted as met for targets and
  removed from the loop's working set — the same handling as a design ceiling, for a different
  reason. The report must say what to do about it: the corpus needs claims anchored to real code
  coordinates, which is completeness and placement work, not correctness work.
- **Added (#36) `corpus_hash`**, alongside `rubric_hash` in every `inventory.mjs` run and in each
  `history.jsonl` round. Changing `docs_dirs`, `docs_files`, `entry_files`, `exclude`, `index_file`
  or `exclude_untracked` moves `files_total`, `claims_total`, the freshness denominator and the
  pollution denominator at once — every score across that round becomes incomparable while
  `rubric_hash` does not move a character. Until now the only defence was a hand-written line in
  `history.jsonl`'s `notes`, and a hand-written record is exactly what docgrad marks other repos down
  for. `report` now draws a break on this field too. Rounds recorded before this version carry no
  `corpus_hash` and are treated as unknown, which does not block anything.
- **Added (#35) visibility for the pollution surface's irreproducibility, and an opt-in fix.** The
  pollution ratio is a **rated** input, and it is computed by walking the filesystem rather than
  asking git — so an untracked local draft inside an excluded directory changes a star rating.
  Measured on one repo at a single commit: ratio 0.1066 in a working checkout against 0.0517 in a
  clean worktree, with the `pollution_max: 0.1` downgrade threshold sitting between them. Two people
  can rate the same commit differently, and nothing in the output said why. Now: `inventory.mjs`
  reports an `untracked` block (count, tokens, paths — all `null` rather than zero when git is
  unavailable), `pollution` carries a `note` whenever a collected file is untracked, and
  `.docgrad.yml` accepts `exclude_untracked` to measure the clean-checkout corpus instead.
  **The default is `false`, so no existing rating changes** — a silent change to everyone's economy
  star is precisely the failure this tool exists to catch. Untracked files are detected as the
  complement of `git ls-files`, deliberately **not** via `--exclude-standard`, which would have
  filtered out the gitignored draft that motivated the whole issue.
- **Known, not fixed**: `exclude` still cannot distinguish "WIP I am ashamed of" from "content I
  deliberately scoped out of this run". On `tj/commander.js`, scoping out translated mirrors charged
  40.6% pollution and capped economy at ★3 while the fixed cost was a perfect 0 — the one dimension
  the convergence loop could not move. That needs a second field and a rubric decision about what the
  pollution surface is actually measuring; it is not addressed here.

## 1.4.0 — 2026-09-13

`.docgrad.yml` adds a new field `docs_files`: brings **single** markdown files outside
`docs_dirs` into the corpus as **ordinary documents** (`type: 'doc'`). **The ★1–★5 anchor text
is unchanged, word for word**, `reference/rubric.md` is unmodified, `rubric_hash` is unchanged.

- **Added (field) `docs_files`**: prompted by oikos wanting to bring root-level `PRODUCT.md`
  (4,378 tokens / 12 claims) and `DESIGN.md` (8,059 tokens / 3 claims) into scoring, which
  revealed the **schema couldn't do it** — corpus collection has exactly one site-wide chokepoint,
  `scripts/lib.mjs › collectFiles()`, all five scripts go through it, and it only accepts
  directories (`docs_dirs`) and single-file entries (`entry_files`/`index_file`). Three workarounds,
  each with a cost:
  - Putting a single file in `docs_dirs` **blows up**: `ENOTDIR: not a directory, scandir
    '…/PRODUCT.md'` (writing it as `PRODUCT.md/` doesn't help either — `path.join` normalizes
    away the trailing slash).
  - `entry_files` picks up the file, but `inventory.mjs › fileType()` labels it `entry`, sending
    it straight into `entry_cost.tokens_est`: oikos measured **9,037 → 21,474**, crossing the
    20,000 threshold in `economy.entry_cost_tiers` → economy **★3 → ★1**. **And that cost is
    fake**: in oikos, these two files are conditionally loaded (the entry file says to read them
    "before starting UI/visual work"), while `reference/init.md`'s criterion is "the agent
    auto-loads it on every task." `reference/audit.md` §Economy also mandates that an auditor
    who finds `entry_cost.files` mismatching reality must record it as a deduction — which
    amounts to trading an inflated fixed cost for a permanent deduction.
  - `docs_dirs: [docs/, ./]`: `collectFiles` does **not** dedupe across `docs_dirs` (dedup only
    happens in the single-file loop), so the whole of `docs/` gets counted twice; and under repo
    root there are floating directories like `.claude/worktrees/` too, so the score becomes
    machine-dependent and non-reproducible.
- **The difference from `entry_files` is "when it's loaded," not "how important it is"**:
  always-loaded → `entry_files` (counts toward fixed cost); conditionally loaded → `docs_files`
  (doesn't count). Either one will pick up the file, and **picking the wrong one won't error —
  it will just distort economy**, inflating it in one direction or underreporting it in the
  other. The criterion and the cost of choosing wrong are written into `reference/init.md`'s
  questionnaire (added as item 3, with later items renumbered).
- **Semantics aligned with the existing single-file entry**: file doesn't exist → silently
  skipped (same as `entry_files`); files already scanned by `docs_dirs` aren't double-counted;
  `exclude` still takes priority (listing a file in `docs_files` doesn't override it — it's still
  counted toward the pollution surface); **it is not a reachability root** — `links.mjs`'s roots
  are still only `index_file` + `entry_files`, and `docs_files` is judged for orphan status the
  same way as an ordinary document. This is deliberate: if no document links to a conditional
  document, the agent can only find it by guessing.
- **Fixed in passing (lib)**: the error message when a single-file entry points at a directory.
  It used to blow up only once `inventory.mjs` tried to read the file, with
  `EISDIR: illegal operation on a directory`, giving no clue which config field was wrong. Changed
  to throw immediately in `collectFiles()`: "`docs_files` may only list a single file, but
  `docs/` is a directory — put the whole directory in `docs_dirs` instead," shared across
  `entry_files`/`index_file` on the same code path.
- **⚠️ Score comparability across 1.4.0 — affects only repos that actually set `docs_files`**.
  Bringing in new files also moves `files_total`/`claims_total`/`tokens_est`, freshness's
  denominator, and the population behind orphans and reachable ratio — that repo's scores
  **cannot be directly compared** across 1.4.0; the baseline should be recalculated from the round
  in which this field was introduced (same nature as the 1.3.0 freshness note: a measurement-scope
  correction, not a quality regression). **Repos that don't set this field see no change in
  output at all** — it defaults to an empty array, no need to rerun `init`.
  - oikos actually ran it (`docs_files: [PRODUCT.md, DESIGN.md]`, `--config` external, no file in
    that repo modified): `files_total` 46 → 48, `claims_total` 317 → 332, `tokens_est` 134,253 →
    146,690, freshness `coverage_ratio` 93.48% → 89.58% (the two newly added files have no
    frontmatter date, so the denominator grows), pollution surface 11.77% → 10.88%.
    **`entry_cost.tokens_est` stays at 9,037** (which is exactly the point of this field), dead
    links/broken anchors/orphans 0/0/0, reachable ratio 100%, `coverage.mjs`'s
    undocumented/drifted are unchanged.
  - `retrieval.mjs` (report-only, doesn't count toward stars) also moves: once the new files are
    in the link graph, a doc that was previously unreachable from `index_file` may become
    reachable, and `marginal_tokens`/`max_depth` shift upward accordingly (oikos measured
    `lib/balance.ts` 32,655 → 41,058, `max_depth` 1 → 3). That's a retrieval path that already
    existed but wasn't visible before now being counted — it isn't the cost getting more expensive.
- **Tests**: 66 → 71 (collecting single files outside `docs_dirs`, dedup, silently skipping
  missing files, `exclude` priority, throwing on a path that points to a directory, `type: 'doc'`
  and excluded from `entry_cost`, orphan detection matching ordinary documents). Added fixture
  `tests/fixtures/docs-files/`, and confirmed by actually removing the `docs_files` loop that all
  5 of these go red.

## 1.3.1 — 2026-09-13

Release process aligned with the official toolchain; pure metadata/docs, no change to any
judgment semantics.

- **`marketplace.json` gets a marketplace-level `description`**: previously only the plugin entry
  had a description, the marketplace itself didn't, `claude plugin validate .` reported a
  warning, and browsers saw an empty field. After the fix, validate is fully green with no
  warnings.
- **Release tags now use `claude plugin tag --push`**: official format is `docgrad--v<version>`
  (annotated); before creating a tag it verifies `plugin.json` matches the marketplace entry, so
  tags are no longer typed by hand.
  - v0.2.0 through v1.3.0 have been backfilled with official-format tags pointing at **exactly
    the same commit** as the old tags (verified one by one against `plugin.json`'s version
    number).
  - The old `vX.Y.Z` lightweight series is kept, not deleted (external links may point to them),
    but **new versions only get the official format** — the two series coexisting only needs to
    cover existing history, not keep growing.
- **`docs/how-to.md` §Cut a release**: rewritten as 7 steps, adding `claude plugin validate .`
  as a pre-release step.

## 1.3.0 — 2026-09-13

A batch of P1s: all come from real runs against oikos/dream-calm-true, not hypothesized.
**The ★1–★5 anchor text is unchanged, word for word.**

- **Fixed (#15, freshness) backfill self-pollution**: git date comparison now excludes docgrad's
  own convergence commits (the `docs(docgrad):` prefix), taking the most recent non-docgrad
  commit instead.
  - Before: after oikos round 1 backfilled `last_updated` for 39 files, that very commit pushed
    the git date of all those files to that same day, so round 2 got **38 false mismatches** —
    half of the second round was spent cleaning up the measurement fallout from the first.
  - **Comparing freshness scores across 1.3.0**: old scores may include false mismatches and run
    low; that's a correction, not a regression.
- **Added (#15) `date_concentration`** (report-only, doesn't affect the star rating): the largest
  same-day share. oikos measured **0.68** (28/41 files stuck on the backfill day) — these files
  will age in lockstep and go stale in lockstep; a `coverage_ratio` of 95% can't tell you who's
  actually been neglected.
  It can't distinguish "backfill" from "genuinely edited at the same time" — it only flags, it
  doesn't judge.
- **Added (#14) graduation artifact**: `templates/docs-gate.mjs` + `templates/docs-gate.yml`. At
  closeout these get copied into the target repo's `.docgrad/graduation/`, with thresholds set to
  match current state — **produced but not installed**, and never written into `.github/`.
  Blocker #3's "don't touch CI" means not auto-modifying it, not that materials can't be produced.
  - Motivation: convergence naturally decays without a gate. On the **same day** oikos closed
    out, a new orphan appeared (`utm-convention.md`) along with a file missing `last_updated`
    (coverage 95.1%→90.7%), and both were still there two months later. Prose recommendations
    produce no artifact, so no one acts on them.
  - `docs-gate.mjs` deliberately does **not** import `lib.mjs` (it gets copied out, decoupled from
    docgrad's install path); instead it calls the already-installed scripts to read the JSON.
    `exit 1` = docs don't meet the bar, `exit 2` = environment problem, so CI can tell whose fault
    it is.
  - The template explicitly notes that dead links/formatting can use more mature off-the-shelf
    tools instead (lychee, markdown-link-check, markdownlint, Vale); docgrad's scripts add
    differentiated value on orphans/reachability and entry-file token budgets.
- **Added (#17) `.docgrad/out-of-scope.jsonl`**: findings outside docgrad's remit (stale code
  comments, CI, product decisions) now land in a machine-readable file, append-only never
  rewritten, and the closeout report must list all `status: open` items with their count.
  - Motivation: oikos round 3 caught `lib/supabase/server.ts`'s docstring going stale, and could
    only write it into notes — still there two months later, because natural-language notes have
    nothing tracking them.
- **Fixed (#13) `report`'s branch divergence**: now checks
  `git rev-list --count HEAD..docgrad/converge` first; if it's > 0, the report warns at the top
  that the trend may be incomplete; the header always states the data source as
  `<branch> @ <short-sha>`.
  - Motivation: oikos's main history stopped at round 4 ("all dimensions ★4, targets met"), but
    the truth was on an unmerged converge branch (round 5 recorded consistency at ★2). Running
    `report` on main gave an overly optimistic trend that didn't match reality, with no warning
    at all.
- **Relaxed (#18) "one dimension per round"**, with two exceptions, both of which must be noted
  in the report:
  - A **trivial-fix allowlist** (dead links, orphans missing from the index, typo-level
    consistency) may be fixed opportunistically in any round — these three categories have full
    mechanical verification, there's no risk of "fixing it halfway and leaving a contradiction,"
    and the rule blocking them just pushes zero-risk fixes to the next round.
  - **Small-corpus mode** (`tokens_est` < 10,000 or `files` < 5) allows multiple dimensions in one
    round. dream-calm-true's scorecard noted to itself that "the two install methods could be
    unified, but changing it would violate one-dimension-per-round" — and a two-line, zero-risk
    fix got pushed out just like that.
  - Neither exception waives step 4's verification: if any dimension drops, revert regardless.
- **Tests**: 64 → 66 (a docgrad commit doesn't count as a content update, `date_concentration`
  catches backfill traces).

## 1.2.0 — 2026-09-13

Filled in the three Testing items from the Anthropic skill authoring checklist (#19), and fixed a
sampling blind spot exposed only while building the evals.

- **Added (#19) skill-level eval suite**: `evals/`, laid out per `claude plugin eval`'s
  `prompt.md` + `graders/*.md` convention, three cases each guarding one failure mode:
  - `linkage-known` — **reproducibility**: dead links 1/12 = 8.33%, and per the anchors that can
    only be linkage ★2, with no room for interpretation. The star rating must be perfectly
    consistent across multiple runs; any divergence gets tracked as a defect.
  - `planted-contradiction` — **sampling coverage**: the contradicting sentence is deliberately
    placed next to the anchor line (that line itself carries no code ref).
  - `clean-baseline` — **false positives**: a fully clean repo must not be docked. Without this
    check, every increase in sensitivity risks quietly turning into false positives everywhere.
  - The mechanical baselines for the three mini-repos in `evals/fixtures/` are listed in
    `evals/README.md`; the graders' assertions are built on these actually-measured numbers, not
    estimates.
  - **Not yet executed**: `claude plugin eval` reports early access locally. The cases are
    written but have never been run once; the docs list no scores. `case.yaml`'s field schema is
    undocumented, so this suite deliberately doesn't write `case.yaml` — better to forgo advanced
    features than guess the format; `--runs`/`--model` are always passed as CLI flags.
- **Fixed (lib) `extractClaimLines` missed the sentence next to an anchor line**: discovered while
  building `planted-contradiction`. The 1.1.0 implementation only picked up lines that themselves
  carried a code ref, but **contradictions are often written in the sentence right after the
  anchor line** — exactly what happened with oikos's balance sign issue, so the new mechanism
  would have reproduced the very blind spot it was meant to fix.
  - Candidates now additionally carry `section` (the heading they belong to) and `section_lines`
    (the start/end line numbers of that section).
  - `reference/audit.md` step 3 now specifies that **the verification scope is the entire
    `section_lines` range**; any sentence within the section that mismatches the code is recorded
    as `fail`, with `claim_id` pointing at the offending line.
  - The definition of `claims_total` is unchanged (still lines that themselves carry a code ref),
    so the cumulative coverage denominator is unaffected.
- **Release process**: `docs/how-to.md` §Cut a release adds "run the evals" as a required step
  (once access is granted), and states explicitly that a report may not fill in scores that were
  never run.
- **Tests**: 63 → 64 (section scope must cover the neighboring sentence, and must not cross into
  the next heading).

## 1.1.0 — 2026-09-13

Correctness sampling changed from "the LLM picks freely each round" to mechanically determined
and accumulated to disk, with history now carrying a version fingerprint.
**The existing ★1–★5 anchor text is unchanged, word for word** — what changes is which claims get
sampled, and what numbers sit next to the score.

- **Fixed (#12) correctness score not reproducible**: re-verifying on the same day as oikos's
  closeout on 2026-07-13, consistency went ★4→★2 (`transactions-design.md`'s balance sign was
  the opposite of `lib/balance.ts`, "not covered by the first four rounds' sampling"). The root
  cause wasn't that the anchors weren't fine-grained enough — it was that **sampling was
  unconstrained**: no matter how fine the anchors, they don't control "which ones get sampled."
  - **The sampling population and draw order are now produced by scripts**: `inventory.mjs`
    adds `totals.claims_total` (non-heading lines outside fences that carry code coordinates) and
    `claim_candidates` (stably sorted by ref count → path → line, top 60 taken). The same corpus
    produces exactly the same order every run (verified with tests).
  - **The ledger accumulates to disk**: `improve`/`loop` append to `.docgrad/ledger.jsonl` each
    round (`claim_id` = `<path>:<line>`, append-only, never rewritten; a new line is appended on
    re-verification, so you can see when something broke and when it was fixed). When line
    numbers drift, the old `claim_id` is kept and marked `moved_from`, to avoid inflating
    cumulative coverage.
  - **Each round re-verifies before sampling new ones**: everything `fail`/`stale` is fully
    re-verified; half of `pass` gets resampled (taking even-indexed positions by sorted
    `claim_id`, reproducible). `audit` **reads** the ledger but doesn't write to it — consistent
    with the rule that "audit is a pure report, it doesn't write to disk."
  - **The report now reads "star rating + coverage"**: `correctness ★4 (pass rate 8/8, cumulative
    coverage 23/68 = 34%)`. A pass rate of 8/8 means something very different at 5% coverage
    versus 60% — giving only the star rating would let readers overestimate confidence. Coverage
    doesn't affect the star rating.
  - Under a scoped audit, cumulative coverage **cannot be reported** (the denominator has been
    narrowed by `--include`, so it means something different from the full-repo figure); the
    ledger is still read, not written.
- **Added (#16) version fingerprint in history**: every line now carries `docgrad_version` and
  `rubric_hash` (the first 8 chars of the sha256 of `reference/rubric.md`'s contents), supplied
  by `inventory.mjs`'s new `docgrad` block, not filled in by the LLM itself. `report` now draws a
  comparability break wherever `rubric_hash` changes — fixing "the ruler changed, but it got
  drawn as a quality regression" (this repo's own round 9 consistency ★5→★4 was exactly this
  case, and at the time it could only be written up as prose in the notes). Old records missing
  the field are treated as unknown and don't block anything.
- **Added (lib)**: `docgradMeta()` (version + rubric fingerprint, returns `null` instead of
  throwing when the file can't be read), `extractClaimLines()`, `rankClaimCandidates()`.
- **`report`**: when `.docgrad/ledger.jsonl` exists, it now also reports cumulative coverage and
  which claims are currently still `fail`/`stale`.
- **Tests**: 59 → 63 (rubric fingerprint changes with content, missing file returns null, claim
  line extraction excludes fences/headings, candidate ranking is stable).

## 1.0.0 — 2026-09-13

> ### ⚠️ BREAKING — rubric structure changed, historical scores need to be recalculated
>
> Adds a sixth dimension, **economy**. Existing `.docgrad/history.jsonl` records in each repo are
> missing the `economy` key, and **"targets met" and overall scores are not comparable across
> 1.0.0** — a convergence loop should restart its baseline (keep the old records, don't delete
> them). **The existing five dimensions' ★1–★5 anchor text is unchanged, word for word** —
> what's incomparable is the dimension composition, not each dimension's own scale.
>
> Upgrade action: rerun `/docgrad audit` on each already-onboarded repo to get a six-dimension
> baseline; `.docgrad.yml` doesn't need to change to run (when `targets.economy` and `economy.*`
> aren't set, defaults apply) — only add fields if you want to adjust the target.

- **Added (dimension) economy** (issue #11): fixed cost and pollution surface are promoted from
  report-only to a star-rated dimension.
  - Anchors: ★1 fixed cost > 20,000 tokens / ★2 > 10,000 ≤ 20,000 / ★3 > 5,000 ≤ 10,000 /
    ★4 ≤ 5,000 and pollution surface < 10% / ★5 ≤ 3,000, pollution surface < 10%, and the
    entry-file token budget is enforced by a mechanical gate.
  - Downgrade rule: when pollution surface ≥ 10%, this dimension is capped at ★3 (otherwise "low
    cost but heavily polluted" would fall into a gap between anchors with no star to assign).
  - Fully mechanical (`inventory.mjs`'s `entry_cost.tokens_est` and `pollution.ratio`), no LLM
    judgment involved.
  - **★5 is judged a design ceiling**: the required mechanical gate touches CI, hitting
    Blocker #3 → capped at ★4 within loop, the same nature as freshness ★5
    (`reference/improve.md` §Dimension cap already has two such examples).
  - Dimension ordered last: it runs counter to completeness (adding documentation pushes fixed
    cost up), so on a tie, content dimensions move first, avoiding loop oscillating between
    "add it back then remove it."
- **Why add a dimension instead of just reporting**: completeness rewards coverage, and when it's
  report-only, every legal move for loop each round is "add more documentation," with nothing
  pushing content not worth its tokens out of the entry file. External evidence (comparisons of
  multiple coding agents on SWE-Bench Lite and AgentBench) shows longer context files raise cost
  without necessarily raising success rate. The cost of adding a dimension (major bump + history
  recalculation) was paid knowingly — contrast with 0.5.0, which deliberately did **not** add a
  sixth dimension when widening consistency's scope: that change was to the judging scope of an
  existing dimension, this one changes the reward direction itself.
- **`improve`'s fix for economy has guardrails**: only "move entry-file content out, leaving just
  a pointer" and "move WIP/historical baggage out of the corpus" are allowed. Anything moved must
  land inside `docs_dirs` and be reachable from the index, otherwise completeness/linkage would
  drop and the verification step blocks it. **Deleting content that's still correct and still
  needed, just to cut cost, is forbidden**; when the only way to bring the cost down is deletion,
  it's judged a plateau, and the trade-off is handed to the user.
- **`report`'s handling of the break point**: rounds missing the `economy` key belong to the
  five-dimension era; that dimension is drawn as `—`, the trend chart draws a break line there
  with a note that it can't be compared to newer rounds.
- **Config**: `targets.economy` (default 4) and `economy.entry_cost_tiers`/`economy.pollution_max`
  (default `[20000, 10000, 5000, 3000]`/`0.1`). Defaults apply when unset; existing repos don't
  need to rerun `init`. Changing the thresholds = changing the rubric anchors = historical scores
  losing comparability; `init` already states "lower the target rather than change the
  threshold."
- **`init` questionnaire**: `entry_files`'s criterion now spelled out explicitly — "the agent
  auto-loads it on every task," not "important." Listing a customer-facing GitHub landing page
  here is a fixed tax paid for nothing (this repo stepped on this itself, see #22 in 0.6.2).
- **scoped audit**: economy **cannot be star-rated under scope** (both fixed cost and pollution
  surface are full-corpus concepts); it reports "not applicable (requires a full audit)," and
  must not be marked ★1 because of that — same as linkage's orphans/reachable ratio.
- **Tests**: 59 (added assertions for the defaults of `targets.economy` and `economy.*`).

## 0.6.2 — 2026-09-13

Structural fixes following a cross-project retrospective (oikos/dream-calm-true/this repo/
kdan-bpm) and comparison against Anthropic's official skill authoring best practices.
**No star-anchor semantics changed; historical score comparability is unaffected.**

- **Fixed (#20) internal inconsistency in the docs**: four places still said "four scripts,"
  but `retrieval.mjs` has been the fifth since 0.6.0.
  - `reference/rubric.md`'s scoring principles item 1, and two places in `reference/improve.md`
    (the placement boundary, graduation recommendations), changed to five.
  - `reference/audit.md` §scoped audit's "four scripts plus `--include`" was doubly wrong: only
    inventory/links/freshness accept that flag, coverage/retrieval deliberately don't
    (`SKILL.md` already documented this). Changed to three, and stated explicitly.
- **Fixed (#21) reference depth and long-file table of contents**: official guidance requires
  every reference file to be reachable from SKILL.md in one hop, and files >100 lines need a
  Contents section.
  - `reference/placement.md` was previously only reachable via rubric.md/audit.md (two hops), yet
    it's the basis for judging consistency's placement/duplication. Blocker #2 now names it
    directly, and it's been made reachable in one hop.
  - `docs/design.md` (161 lines), `reference/audit.md` (151 lines), and `reference/rubric.md`
    (126 lines) got a Contents section added.
- **Fixed (#24) trimmed the rubric body**: version history moved into a `<details>` block titled
  "Version history and comparability notes" at the end of the file; the main body's measurement
  column for each dimension now just points to it in one line. rubric.md is mandatory reading per
  Blocker #2, so every scoring pass pays its token cost; version history is only needed when
  comparing scores across versions.
  - **The anchor table and measurement methods are unchanged, word for word** — only the
    historical notes moved. Freshness ★5's graduation-only note remains a **current rule**
    (improve.md's design ceiling depends on it), not history, so it stays in the main body — only
    the comparability sentence moved into details.
  - Also backfilled 0.2.0 (completeness moved to a mechanical basis via coverage) into the history
    list.
- **Fixed (#26, lib) `collectFiles()` missed `index_file`**: when `index_file` sat outside
  `docs_dirs` and wasn't in `entry_files`, it didn't enter the corpus, so it got filtered out of
  `links.mjs`'s roots (roots only recognize in-corpus paths), and **the entire subtree only
  reachable from the index was misjudged as orphans**, with `reachable_ratio` also marked down
  and no note at all. The index is inherently part of the documentation system, so it's now
  brought into the corpus the same way `entry_files` is.
  - Affected: repos with the index at repo root — their linkage rating was **understated** in
    the past, with deductions even pointing at files that had no problem.
    `index_file` inside `docs_dirs` is unaffected.
  - Regression test: added `tests/fixtures/root-index/`, confirmed red before the fix.
- **Fixed (#22) this repo's own `.docgrad.yml` misreported fixed cost**: `entry_files` used to
  include `README.md`, but that's a GitHub landing page, not part of agent context. After
  removal, fixed cost went 2,823 → **1,047 tokens** (the old value was inflated 1.7x). Also added
  `src_dirs: [scripts/]` and `scenarios:`, taking coverage/retrieval out of degraded mode.
- **Fixed (#23) frontmatter**: `license` changed to the valid SPDX identifier `MIT` (the old value
  `MIT. See NOTICE.md for attribution.` mixed in explanatory text); removed `user-invocable: true`
  (that field defaults to true anyway; it's only meant for setting to false).
  - **`allowed-tools` not adopted**: a Bash rule must match exactly up to the first `*`, and a
    skill doesn't know its own installed absolute path at authoring time; the only portable
    pattern is `Bash(node *)`, which effectively pre-authorizes any node command. Instead,
    `docs/how-to.md` teaches users to add a rule using their own absolute path.
- **Verification**: `node --test tests/*.test.mjs` **59 pass**; this repo's dead 0/bad_anchors
  0/orphans 0/reachable 1.0, freshness coverage 1.0/stale 0/mismatch 0/pollution surface 0%
  (the newly added Contents anchors all pass the check after aligning with GitHub slug rules).

## 0.6.1 — 2026-09-05

- **Fixed (links/lib)**: a family of three false broken-anchor reports, all traced to slug
  generation being inconsistent with GitHub. Measured against kdan-bpm, 18 `bad_anchors` went to
  zero after the fix (dead 0/orphans 0/reachable 1.0 unchanged).
  - `githubSlug()` now converts each run of whitespace to one dash (previously collapsed `\s+`
    into a single dash). Adjacent whitespace left behind after punctuation is stripped produces a
    double dash on GitHub: `## 狀態圖例 (status / sot_level legend)` →
    `狀態圖例-status--sot_level-legend`.
  - `extractHeadings()` now only strips underscores used **for emphasis**; underscores inside a
    word are literal (per GFM rules). It used to strip them unconditionally, so `sot_level` got
    computed as `sotlevel`, breaking every link to that section.
  - `extractHeadings()` now recognizes explicit anchors `<a id="x">`/`<a name='x'>` (including
    ones with other attributes before them). Long-lived links often switch to explicit anchors;
    previously only `#` headings were recognized, so all of these were misreported.
- **Fixed (inventory)**: `entry_cost` now dedupes symlink aliases — when multiple entry names
  point at the same physical file (e.g. `CLAUDE.md -> AGENTS.md`), the agent only loads it once,
  but summing per name doubled the fixed cost (measured 5,792 vs a true value of 2,896). `files`
  still lists every name; a new `symlink_aliases` marks the collapsed aliases.
- **Docs**: `reference/audit.md`/`reference/rubric.md` removed the exception "manually confirm
  `cjk_uncertain` broken anchors before counting them" — that exception existed only to paper
  over the bug above; now that it's fixed, broken anchors are always counted, and
  `cjk_uncertain` is downgraded to an informational field.
- **Tests**: 54 → 58 (one each for the double-dash slug, in-word underscores, explicit anchors,
  symlink dedup).

## 0.6.0 — 2026-09-04

- **Added (script)**: fifth measurement script `scripts/retrieval.mjs` — traceability and
  marginal cost, report-only (doesn't count toward stars). For each entry in `.docgrad.yml`'s new
  `scenarios:` field (a list of representative code paths), it computes `marginal_tokens`
  (entry_files + index chain + anchoring doc tokens, each file counted once), `max_depth` (how
  many hops a BFS from `index_file` needs to reach the farthest anchoring doc), `fan_in` (how
  many docs anchor it), `code_pointer` (whether that path's code points back to any doc), and
  `churn_commits` (commit count over the past 90 days, weighted to flag the "most heavily taxed"
  scenario); when there's no `scenarios:`, it still gives `areas` (`code_pointer`/`fan_in` per
  top-level subdirectory of `src_dirs`) and `index_hotness` (`index_file`/`entry_files`'s
  90-day commit count `ratio` against the median across all docs, plus `top5`). Doesn't accept
  `--include` (same reasoning as `coverage.mjs` — traceability is a full-index/retrieval concept).
  Added the pure function `lib.mjs › extractCodeRefs()`: extracts backtick-wrapped paths that
  start with a `src_dirs` prefix, `` `path › symbol` `` form, and bare filenames (matched against
  basename), shared by `retrieval.mjs`/`inventory.mjs`, with no directory name hardcoded. A hit in
  the ancestor direction (a doc pointing at a parent directory of the query) only counts a ref
  **strictly deeper than the owning `src_dirs`** — a mention of the whole app in general doesn't
  count as "a doc that governs this file," otherwise the same doc would be a fixed hit for every
  scenario.
- **Added (field)**: `inventory.mjs` now outputs `structure: {h2: [{title, tokens_est}], rules:
  {count, median_chars, p90_chars, anchored_ratio}}` per file (`rules.pattern` is a new config key,
  default `**MUST`; a list item containing that string counts as a rule line; `anchored` means
  that line itself yields coordinates via `extractCodeRefs`); `totals` adds `rules_total`/
  `rules_anchored_ratio` (aggregated across all files, not a per-file average). Files with no H2
  still get a `structure`, just empty.
- **Fixed (measurement artifact)**: `freshness.mjs`'s `freshness.convention` now accepts multiple
  values separated by comma/`+` (`frontmatter, heading-line`), and `extractClaimedDate` tries them
  in order, taking the first one it extracts; the output `convention` always returns the actual
  list adopted (previously a single value was also a string — this is an output shape change, not
  a measurement semantics change — `coverage_ratio`'s judgment logic itself is unchanged). Added
  `freshness.heading_field` (the in-line keyword used for heading-line); when only `field` is set
  and convention includes heading-line, it falls back to using `field` (backward compatible with
  old config). Fixes the measurement artifact where "only one date convention is recognized at a
  time, so repos mixing conventions show a falsely low `coverage_ratio`, requiring manual
  deduction every round" (motivation: kdan-workforce measured that
  `docs/superpowers/specs/` uses frontmatter while `docs/integrations/`+`docs/runbooks/` use
  heading-line, and a single value only recognized about 76%).
- **Compatibility**: this version is **not a rubric anchor change** — the ★1–★5 judgment
  thresholds are unchanged, word for word, and historical score comparability is unaffected
  (both the Token Economy and the new "traceability" section are report-only). The new
  `.docgrad.yml` fields (`scenarios`/`rules`/`freshness.heading_field`) are all optional; when
  unset, the four existing scripts' output is unchanged; `freshness.convention`'s single-value
  behavior is unchanged. Existing repos don't need to rerun `/docgrad init` to keep using the old
  config — only add fields to use the new signals.

## 0.5.0 — 2026-07-26

- **Added**: `reference/placement.md` — information placement policy. Three trade-off axes
  (access cost / drift risk / audience breadth) decide the authoritative home for each category of
  information: putting everything in the entry file is the lowest access cost but the most
  expensive in token tax and the most prone to rot, so audience breadth arbitrates. Six decision
  rules, including how to cut decision-relevant information — **the rationale for a current
  conclusion is written into the spec it constrains**, not into a separate log (rationale and
  conclusion travel together, overwritten rather than accumulated, and must include the rejected
  alternatives and the conditions that rejected them); debate history stays in an issue. (issue #4)
- **Measurement scope change (not an anchor change)**: consistency's judgment scope widens from
  "within docs" to **docs ↔ code comments/spec** placement and duplication; deductions are split
  into `[contradiction]`/`[duplication]`/`[placement]`. The ★1–★5 anchor text is unchanged, but a
  repo previously at ★5 may get marked down due to cross-carrier duplication — when comparing
  consistency scores across 0.5.0, the report should note the scope has widened (same nature as
  0.2.0's move of completeness to a mechanical coverage basis). Decided to widen the dimension
  rather than add a sixth: adding a dimension = rubric structure change = major bump + recalculating
  every repo's history.
- **Convergence discipline**: when `improve`/`loop` picks consistency, one round fixes one class of
  deduction (`[contradiction]` → `[duplication]` → `[placement]`). For the placement class, **only
  files within docs scope are touched** — recommendations to move content into code comments or
  other source files are never auto-executed (beyond the "commit only docs changes" branch
  discipline, and scripts can't verify code comments anyway); instead they go into the report's
  "needs human handling" list, so getting stuck here is judged a design ceiling, not a plateau.
- **Positioning**: `docs/design.md` adds the boundary between "information placement" and "code
  quality" — judging placement means reading code comments, but not evaluating comment quality,
  otherwise the consistency dimension would slide into a code review.

## 0.4.0 — 2026-07-26

- **Added (command)**: `audit <scope>`/`audit --dim <dimension>` — scoped audit, limited to a
  directory/glob/topic or a single dimension. Always pure report and **never writes to
  `.docgrad/`** (mixing scoped scores into history would wreck cross-round comparability); each
  dimension's validity and report header format under a limited scope is in `reference/audit.md`
  §scoped audit. (issue #2)
- **Added (CLI)**: shared flags for the four scripts are now parsed in one place,
  `scripts/lib.mjs › parseArgs()`, adding `--include <glob>` (repeatable/comma-separated,
  supports `**`/`*`/`?` and directory prefixes) and `--config <file>` (external config — used when
  the doc source itself can't hold files on disk). Unknown flags always throw, no longer silently
  ignored. (issue #2, #3 suggestion 2)
- **Measurement semantics**: `links.mjs` returns `[]` for orphans and `null` for reachable ratio
  when scope is limited (reachability is a full-index concept and gets distorted the moment scope
  narrows — it must not be docked for that); `coverage.mjs` deliberately doesn't accept
  `--include` (narrowing the docs side would misjudge out-of-scope mentions as undocumented), and
  says so in `note`; `inventory.mjs`'s `entry_cost.files` now lists the entry files actually
  counted.
- **Compatibility**: without flags, the four scripts' output is the same as 0.3.0 except for one
  added `scope: null` field; rubric anchors unchanged.

## 0.3.0 — 2026-07-26

- **Added (loop behavior)**: `reference/improve.md` adds the **design ceiling** — when a
  dimension's next star anchor falls inside a Blocker's forbidden zone, that dimension is
  directly judged "converged within docgrad's remit," removed from dimension selection and
  targets-met judgment, and named in the graduation recommendation. Fixes the structural
  contradiction of "freshness ★5 requires a CI gate / Blocker #3 says don't touch CI" being
  misreported as a plateau (issue #1).
- **Docs (applicability boundary)**: README/SKILL.md/`docs/design.md` now state the precondition
  up front — a local markdown file tree with a writable `.docgrad.yml`; git isn't a hard
  requirement (without git, freshness degrades to claimed-only); wiki/remote doc sources aren't
  supported, though that scenario can independently borrow the rubric's five-dimension anchors for
  manual scoring (the boundary-documentation part of issue #3).
- **Note (not an anchor change)**: the rubric marks freshness ★5 as graduation-only scope.
  The ★1–★5 judgment thresholds are unchanged, word for word; historical score comparability is
  preserved.

## 0.2.0 — 2026-07-13

- **Added**: fourth measurement script `scripts/coverage.mjs` (coverage drift) — git-compares each
  code area against the docs mentioning it, mechanically detecting `undocumented`/`drifted`
  areas, and feeds that into completeness's star rating. Fixes the hole where "a new feature grows
  inside an existing module with no docs written, and completeness ★5 stays falsely pinned."
- **Config**: `.docgrad.yml` adds `src_dirs` and `coverage:` (`drift_after_days: 30`,
  `min_commits: 3`). Existing repos need to rerun `/docgrad init` or manually add `src_dirs`; when
  unset, completeness degrades to pure LLM comparison (same as the old behavior).
- **Measurement method change (not an anchor change)**: the rubric's completeness "measurement"
  line now uses coverage output as its mechanical basis; the star anchors are unchanged, word for
  word, and historical score comparability is preserved.
- **Release**: turned into a plugin (`.claude-plugin/plugin.json` + `marketplace.json`), supporting
  install and version-update notifications via
  `/plugin marketplace add redtear1115/docgrad`.

## 0.1.0 — 2026-07-12

- Initial release: five-dimension rubric (completeness/correctness/freshness/linkage/consistency)
  + token economy report; five commands `init · audit · improve · loop · report`; three
  zero-dependency measurement scripts (inventory/links/freshness).
