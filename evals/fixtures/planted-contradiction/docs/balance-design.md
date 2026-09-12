# 結算設計

> **Last updated:** 2026-09-13

結算由 `src/balance.ts › settle()` 負責。

回傳值為**正數**時，代表 `memberA` 欠 `memberB`。

計算方式是把 `memberB` 的支出總額減去 `memberA` 的支出總額。
