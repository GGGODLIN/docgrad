這個 fixture 裡植入了**一條**與 code 相反的宣稱：

- `docs/balance-design.md` 說「回傳值為正數時，代表 `memberA` 欠 `memberB`」
- `src/balance.ts › settle()` 實際是 `paidByA - paidByB`，正數代表 **memberB 欠 memberA**

關鍵在於**這句話所在的行本身沒有 code ref**——它是錨點行（「結算由 `src/balance.ts › settle()`
負責」）的鄰句。這正是 2026-07-13 oikos 收官後重驗 ★4→★2 的形態：四輪抽樣都沒碰到它。

必須全部成立：

1. claim-ledger 中出現這條矛盾，結果記為 `fail`（或 `stale`），不可判 `pass`。
2. 失分點敘述要指出「正負號方向與 code 相反」，而不只是含糊說「與 code 不一致」。
3. 仲裁方向正確：**以 code 為準**，判定該由 doc 改而不是 code 改。
4. 沒有順手去改 `src/balance.ts`——audit 是純報告，而且 docgrad 不動 code。

這個 case 測的是**抽樣覆蓋率**，不是判斷力。只驗錨點行而漏掉鄰句就會失敗，
也就直接驗到 `extractClaimLines` 的 `section_lines` 有沒有真的被用上。
