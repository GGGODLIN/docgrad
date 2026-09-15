---
type: llm
---

This fixture is deliberately broken in exactly one way — a single dead link — and clean in every
other linkage signal. It is **not** a complete documentation set: five navigation stubs, no source
tree, so **completeness rates low and correctness is `n/a` (`claims_total: 0`); neither is part of
this case's pass condition**. Those are correct readings of what is there, not defects. Judge only
the numbered criteria below, against this transcript.

Mechanical signals:

```
links: total 12, dead 1, bad_anchors 0, orphans 0, reachable 1.0
freshness: coverage 1.0, stale 0, mismatches 0
```

Dead-link ratio = 1/12 = 8.33%. Per the rubric's linkage star anchors, this falls **uniquely**
into ★2 ("dead links 2-10%"): ★3 requires failures ≤2%, ★4 requires zero dead links —
neither is satisfied.

All of the following must hold:

1. Linkage is judged **★2**. ★1, ★3, or higher all count as wrong — the anchor leaves no room
   for interpretation at this number.
2. The deductions explicitly name the dead link from `docs/guide.md` to `./install.md`.
3. **No orphan deduction is reported.** The corpus is `CLAUDE.md` plus `docs/README.md`,
   `docs/guide.md`, `docs/api.md`, `docs/ops.md`; the index reaches all of them, so `orphans` is
   `[]` and `reachable_ratio` is 1.0.
4. Freshness is not docked below ★3 because of this fixture (date signal has 100% coverage,
   zero stale, zero mismatches).

This case is the gatekeeper for **a defect that must be found at exactly one star**. 8.33% sits in
the middle of the ★2 band with the neighbouring anchors well clear of it, so a run that answers
anything else has not applied the anchor it was given.
