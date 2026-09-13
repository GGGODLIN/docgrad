# Documentation gate (produced by docgrad, not installed)

This directory holds a CI gate docgrad generated when this repo hit its targets. **It is not
running.** Nothing installed it, and nothing will until someone does the step below.

- `docs-gate.mjs` — the check. Reads the output of docgrad's `links`, `freshness` and `inventory`
  scripts and exits 0 (pass), 1 (docs failed the gate) or 2 (environment problem: it could not find
  a docgrad install).
- `docs-gate.yml` — a workflow that runs it.

## Run it by hand

```bash
DOCGRAD_DIR=/path/to/docgrad node .docgrad/graduation/docs-gate.mjs --root .
```

`DOCGRAD_DIR` may point at the docgrad repo root or at the skill directory itself. With it unset the
script looks in the usual install locations and exits 2 if it cannot find one.

## Install it

Put `docs-gate.mjs` in `.github/scripts/` and `docs-gate.yml` in `.github/workflows/`. docgrad
deliberately does not do this for you — it does not modify anyone's CI.

## The thresholds expire. Plan for it.

`THRESHOLDS` at the top of `docs-gate.mjs` was pinned to this repo's state on the day it graduated:

| Threshold | Pinned to | State at graduation |
|---|---|---|
| `max_dead_links` | _fill in_ | _fill in_ |
| `max_bad_anchors` | _fill in_ | _fill in_ |
| `max_orphans` | _fill in_ | _fill in_ |
| `min_freshness_coverage` | _fill in_ | _fill in_ |
| `max_entry_cost_tokens` | _fill in_ | _fill in_ |

Three of those are absolute counts and stay meaningful. **`min_freshness_coverage` is a ratio, and a
ratio threshold goes red on its own when the corpus grows** — adding documents enlarges the
denominator, and new documents usually arrive without a date signal. Growing the corpus is something
docgrad encourages, so this is a normal event, not a failure.

Measured on a real repo: pinned at 0.93 when the corpus was 46 files; four rounds later the corpus
was 50 files, coverage read 0.90, and the gate had been red for four rounds without anyone noticing,
because nothing was running it.

When it goes red, decide which happened:

- **The documentation decayed** → fix the documentation. That is what the gate is for.
- **The corpus grew and the new files have no date signal** → add the signal to the new files,
  which is also fixing the documentation.
- **The threshold no longer describes what this repo is willing to enforce** → change it
  deliberately, and record why. Lowering it to make a red light go away converts the gate into
  decoration.

`docgrad audit` and `docgrad report` evaluate these thresholds against current measurements on every
run and tell you the verdict. They **do not execute this file** — running a script committed into
the repo being graded is not something a docs scorer should do. Treat their verdict as a reading of
what this gate declares, and this file as the thing CI actually runs once you install it.
