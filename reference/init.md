# init — one-time setup

> **Last updated:** 2026-09-13

Purpose: scan the target repo → confirm via questionnaire → write `.docgrad.yml` into the target repo's root (under version control, shared by the team).
When `.docgrad.yml` already exists, rerunning init = rescan, using the existing config as the questionnaire's defaults.

## 1. Scan (finish the whole scan, then ask once)

| Item | Detection method | Candidates |
|---|---|---|
| docs directory | Glob top-level directories | `docs/`, `doc/`, `documentation/`; other top-level directories containing >=3 .md files |
| entry file (always-loaded) | Glob root and .github/ | `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md` |
| single-file document (conditionally loaded) | Glob root's .md files, minus entry file/index file candidates | `PRODUCT.md`, `DESIGN.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md` |
| index file | inside the docs directory | `README.md`, `index.md`, `TOC.md` |
| excluded directories | name patterns + .gitignore | `archive/`, `deprecated/`, `generated` markers, gitignored WIP directories |
| src directory | Glob top-level directories | `src/`, `lib/`, `app/`, `packages/`; other top-level directories containing code |
| freshness convention | sample 5 docs files, check the header | frontmatter date field / a "Last updated:"-style line / none |

## 2. Questionnaire (AskUserQuestion, each item pre-filled with the scan result)

1. `docs_dirs` (multi-select, pre-filled with scan candidates)
2. `entry_files` (multi-select) — the criterion is "**loaded automatically by the agent on every task**," not "important."
   A human-facing GitHub landing page (typically the root `README.md`) should **not** be listed unless it is also an agent entry point:
   since v1.0.0, fixed cost is star-rated (economy), so listing one extra is a tax paid for nothing, and omitting a must-read file underreports it.
   When it is also the index, just put it in `index_file` — no need to duplicate it in both places.
3. `docs_files` (multi-select) — a **single markdown file outside `docs_dirs`**, included in the corpus as a **regular document**
   (`type: 'doc'`, not counted toward fixed cost). Typically the repo root's `PRODUCT.md`/`DESIGN.md`.
   - **The difference from `entry_files` is "when it loads," not "how important it is"**: loaded automatically on every task →
     `entry_files`; read only when doing a certain kind of work (the entry file says "read `DESIGN.md` before touching the UI") →
     `docs_files`. Listing one document in both places is pointless — `entry_files` wins and counts toward fixed cost.
   - **Getting this wrong has an asymmetric cost.** Stuffing a conditional document into `entry_files` inflates fixed cost for
     nothing (measured on oikos: 9,037 → 21,474 tokens, crossing the 20,000 threshold in `economy.entry_cost_tiers` and dropping
     economy from ★3 to ★1), and [audit.md](audit.md) §Economy will find `entry_cost.files` doesn't match reality and **log a
     separate** deduction. The reverse (putting a truly always-loaded file into `docs_files`) underreports fixed cost, which is
     equally false.
   - **Files only**: listing a directory drops it (put directories in `docs_dirs`); a nonexistent file is silently skipped;
     files already scanned under `docs_dirs` don't need to be listed again (duplicates count once anyway).
   - **Not a reachability root**: it is subject to orphan detection like a regular document — some document must link to it, or
     linkage will log an orphan. This is deliberate — if a conditional document can't be reached by a link, the agent can only
     find it by guessing.
4. `index_file` (single-select; no candidate → set to `null` and note: linkage will be capped for lack of a reachability root;
   improve's first round can build an index for you)
5. `exclude` (multi-select; scanned candidates + free text)
6. freshness `convention` (frontmatter / heading-line / none; multi-select — when a repo mixes both conventions, select more than
   one and write them comma-separated) + `field` (for frontmatter) / `heading_field` (for heading-line; can be left blank when
   only one convention is chosen and it's already described by `field` — the scripts fall back to `field`)
7. `targets`: default all 4 (six dimensions), ask "which dimensions are you willing to lower to 3?" (multi-select).
   If economy is hard to hit because the repo's entry file is inherently large, lower the target rather than change
   `economy.entry_cost_tiers` — changing the threshold changes the rubric anchor, which makes historical scores incomparable
8. `scenario`: ask the user to describe the repo's representative development task in one sentence (used as the LLM-simulation
   fallback when `scenarios` is absent)
9. `correctness_sample`: default 8; for a large docs system (>50 files), 12 is recommended
10. `src_dirs` (multi-select, pre-filled with scan candidates; used by coverage drift detection and retrieval.mjs): leaving it
    empty → completeness falls back to pure LLM comparison (coverage.mjs doesn't measure, it only emits a note); retrieval.mjs's
    `areas`/`code_pointer_ratio` degrade the same way
11. `scenarios`: ask the user for 2-4 representative code paths (files or directories, e.g.
    `apps/api/src/contract/contract-approval.service.ts`, `apps/api/src/timesheet`) — retrieval.mjs uses them to mechanically
    compute marginal cost and traceability (see [rubric.md](rubric.md) §Token economy report / Traceability); leaving it empty
    falls back to LLM simulation from `scenario`, which still produces areas/index_hotness
12. `rules.pattern`: the rule-line detection string, default `**MUST` (reuse whatever rule-marking convention the repo already
    has; usually no need to change it)

## 3. Write the file

Write `.docgrad.yml` (fill in all values from the questionnaire results; use only a two-level structure and inline lists, so the
scripts can parse it):

```yaml
# .docgrad.yml — docgrad config (under version control, shared by the team)
docs_dirs: [docs/]
docs_files: [PRODUCT.md, DESIGN.md]   # single files outside docs_dirs, taken in as regular documents (not counted toward fixed cost); optional
entry_files: [CLAUDE.md]
index_file: docs/README.md
exclude: [docs/archive/]
src_dirs: [src/]
freshness:
  convention: frontmatter   # single value; when mixing both conventions: frontmatter,heading-line
  field: last_updated
  # heading_field: "Last updated:"   # inline keyword for heading-line; can be omitted when only one convention is chosen and field is already set
coverage:
  drift_after_days: 30   # how many days doc can lag behind code before it counts as drift (default 30)
  min_commits: 3         # how many code commits in that period before it counts as drift (default 3)
targets:
  completeness: 4
  correctness: 4
  freshness: 4
  linkage: 4
  consistency: 4
  economy: 4
economy:
  entry_cost_tiers: [20000, 10000, 5000, 3000]   # fixed-cost thresholds for economy ★1/★2/★3/★4→★5
  pollution_max: 0.1                              # pollution surface cap; economy is capped at ★3 above this
correctness_sample: 8
scenario: "add a typical new feature to <some module>"   # LLM-simulation fallback when scenarios is absent
scenarios: [src/foo/bar.ts, src/foo]      # used by retrieval.mjs to mechanically simulate marginal cost + traceability; optional
rules:
  pattern: "**MUST"   # rule-line detection string (used by inventory.mjs structure.rules), this is the default
language: zh-TW
```

As soon as it's written, verify: it's only done once `node "$SKILL_DIR/scripts/inventory.mjs" --root .` produces JSON output.

## When the doc source is not writable (config file elsewhere)

When the doc tree itself can't take a written file (a read-only mount, an export directory) → write `.docgrad.yml` elsewhere,
and the scripts can run `audit` by specifying `--config <file>` (`improve`/`loop` still need a writable workspace with git).
This only solves the config file's placement — it doesn't change the premise that "the docs must be a local markdown file
tree." See [design.md](../docs/design.md) §Positioning and boundaries for the boundary.

## 4. Wrap-up

- Print a summary of what was written (one line per field).
- Suggest the user commit `.docgrad.yml` to version control; with their consent, commit it on their behalf
  (message: `chore: docgrad init — doc scoring config`).
- Prompt the next step: run `/docgrad audit` to see the first scorecard.
