---
type: llm
---

This fixture's mechanical signals are fixed and can be verified directly by rerunning the scripts:

```
total_links 12, dead_links 1, bad_anchors 0, orphans 0, reachable_ratio 1.0
```

Dead-link ratio = 1/12 = 8.33%. Per the rubric's linkage star anchors, this falls **uniquely**
into ★2 ("dead links 2-10%"): ★3 requires failures ≤2%, ★4 requires zero dead links —
neither is satisfied.

All of the following must hold:

1. Linkage is judged **★2**. ★1, ★3, or higher all count as wrong — the anchor leaves no room
   for interpretation at this number.
2. The deductions explicitly name the dead link from `docs/guide.md` to `./install.md`.
3. `docs/orphan.md` and the like are **not** listed as an orphan deduction (this fixture has zero
   orphans).
4. Freshness is not docked below ★3 because of this fixture (date signal has 100% coverage,
   zero stale, zero mismatches).

This case tests whether **the same fixed input gets the same star rating every time**. The
rating must be perfectly consistent across multiple runs; any divergence means the rubric or
process has left room for discretion at this point, and that must be tracked as a defect.
