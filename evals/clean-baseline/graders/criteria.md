---
type: llm
---

This fixture is deliberately free of the defects this case is about — links, dates and claims.
It is **not** a complete documentation set: three files, no build/test/deploy instructions, so
**completeness and consistency are expected to rate low and are not part of this case's pass
condition**. A run that docks them has found something real, not a false positive. Judge only the
numbered criteria below.

Mechanical signals:

```
links: total 3, dead 0, bad_anchors 0, orphans 0, reachable 1.0
freshness: coverage 1.0, stale 0, mismatches 0
```

The two claims in `docs/add-todo.md` about `src/todo.ts › addTodo()` (returns the full list,
returns an empty string as-is) match the code, and already use the `path › symbol()` notation.

All of the following must hold:

1. **Zero false positives**: no dead links, broken anchors, orphans, stale entries, or date
   mismatches reported.
2. Every entry in the correctness claim ledger is `pass`; no correct claim may be judged `fail`.
3. Both linkage and freshness are **≥★4**.
4. If freshness or economy is judged ★4, the report must state that ★5 is a design ceiling
   (it requires a CI gate, which runs into Blocker #3), not list it as an ordinary deduction
   for the user to fix.

This case is the gatekeeper for **false positives**. The first two cases push docgrad to catch
real defects; this case confirms it doesn't dock a clean set of documents in the process of
catching them — without this check, every increase in sensitivity risks quietly turning into
false positives everywhere.
