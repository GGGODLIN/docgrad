# Case study 2 — docgrad on itself, nine rounds of real history

> **Last updated:** 2026-09-13

**What this measures:** where a documentation system's tokens end up as the product grows.
**What it does not measure:** end-to-end agent token usage on a task. That is
[case study 1](01-commander-js.md).

docgrad has been run on its own repository since its first week. The convergence rounds are real
commits, the scores are in `.docgrad/history.jsonl`, and every number below was re-measured for this
write-up rather than copied out of an old scorecard.

## Method

Four snapshots of the repository, extracted from git and measured with **one** version of the
scripts (HEAD, v1.4.0) and **one** config, so the ruler is constant across all four:

```bash
# from a clone of docgrad
mkdir -p /tmp/cs2/tool && git archive 48f3d1a | tar -x -C /tmp/cs2/tool
for ref in 71e7be8 cf97522 0fb7e01 48f3d1a; do
  mkdir -p /tmp/cs2/snap/$ref && git archive $ref | tar -x -C /tmp/cs2/snap/$ref
  node /tmp/cs2/tool/scripts/inventory.mjs --root /tmp/cs2/snap/$ref --config /tmp/cs2/tool/.docgrad.yml
  node /tmp/cs2/tool/scripts/links.mjs     --root /tmp/cs2/snap/$ref --config /tmp/cs2/tool/.docgrad.yml
  node /tmp/cs2/tool/scripts/retrieval.mjs --root /tmp/cs2/snap/$ref --config /tmp/cs2/tool/.docgrad.yml
done
```

The snapshots are not a clean A/B — the code grew between them too, which is the point of the
comparison but also its main confound. See [Threats to validity](#threats-to-validity).

| Snapshot | What it is |
|---|---|
| `71e7be8` | `chore: docgrad init` — the baseline audit scored it ★3 / ★3 / ★1 / ★4 / ★3 |
| `cf97522` | round 4, the first time every dimension met its target |
| `0fb7e01` | round 9, the close-out round |
| `48f3d1a` | v1.4.0, today's HEAD (four feature releases after the close-out) |

## What came out

| | round 0 | round 4 | round 9 | HEAD v1.4.0 |
|---|---:|---:|---:|---:|
| Documents | 7 | 8 | 9 | 9 |
| Corpus tokens | 7,809 | 8,497 | 16,691 | **26,739** |
| **Fixed cost** (every task pays this) | 705 | 713 | 958 | **1,286** |
| Fixed cost as a share of corpus | 9.0% | 8.4% | 5.7% | **4.8%** |
| Links | 9 | 15 | 44 | 91 |
| Dead links | 1 | 1 | 0 | **0** |
| Orphans | 0 | 0 | 0 | 0 |
| Reachable ratio | 1.0 | 1.0 | 1.0 | 1.0 |
| Marginal cost, scenario `scripts/links.mjs` | 3,948 | 4,143 | 6,946 | 8,847 |
| Marginal cost, scenario `scripts/lib.mjs` | 705 | 1,536 | 8,138 | 10,804 |

**The corpus grew 3.4×. The tax every task pays grew 1.8×, and its share of the corpus halved.**

That is the whole claim, and it is a narrower claim than "docgrad makes your docs cheaper". Nothing
here got cheaper in absolute terms. What the convergence loop bought was control over *where* the
growth landed: nine rounds added 19,000 tokens of documentation while adding 581 tokens to the file
that is loaded on every single task.

Two secondary readings:

- **Marginal cost went up, not down.** An agent changing `scripts/lib.mjs` at round 0 paid 705
  tokens to get oriented — because no document mentioned that file at all. `retrieval.mjs` reported
  `max_depth: -` and `fan_in: 0`: the code had no path back to a spec, so the cheap number was cheap
  for the worst possible reason. By HEAD, two documents anchor that file and the path costs 10,804
  tokens. Whether that is a better trade depends on what the agent would otherwise have spent
  reading 4,180 lines of source to infer the same thing, which this case study does not measure.
- **Dead links went to zero at round 7 and stayed there** across four subsequent feature releases
  that added 47 more links. The releases were not done under docgrad supervision; the convention
  held on its own once the docs had an index that reached everything.

## Threats to validity

- **The code grew between snapshots.** These four points differ in product surface, not only in
  documentation discipline. The fixed-cost figure is still a fair comparison (it is one file's token
  count under one ruler), but "corpus tokens" conflates "we documented more" with "there was more to
  document".
- **Self-selection.** This repository is the tool's author's own, converged by the tool's author.
  It shows what the workflow looks like when followed exactly, not what it does in someone else's
  hands. That is why [case study 1](01-commander-js.md) uses a repository nobody involved here
  maintains.
- **`marginal_tokens` has a known double-count.** `retrieval.mjs` computes
  `entry_tokens + Σ(anchoring docs)`, and an entry file that is also an anchoring doc is counted
  twice. It does not affect the columns above (docgrad's entry file is not in `docs_dirs`), but it
  inflates the figure on repos where those sets overlap. The field is report-only and rates nothing.
- **One rating scale change.** The consistency dimension's scope widened in v0.5.0; that affects the
  star history in `.docgrad/history.jsonl`, not the mechanical columns in the table above.
