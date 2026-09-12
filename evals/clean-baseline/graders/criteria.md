這個 fixture 刻意沒有任何缺陷。機械訊號：

```
links: total 3, dead 0, bad_anchors 0, orphans 0, reachable 1.0
freshness: coverage 1.0, stale 0, mismatches 0
```

`docs/add-todo.md` 對 `src/todo.ts › addTodo()` 的兩條宣稱（回傳完整清單、空字串原樣回傳）
與 code 一致，且已使用 `path › symbol()` 記法。

必須全部成立：

1. **零誤報**：不報任何死鏈、壞錨、孤兒、stale、日期 mismatch。
2. 正確性的 claim-ledger 全數 `pass`，不得把正確的宣稱判成 `fail`。
3. 連結度與新鮮度皆 **≥★4**。
4. 若把新鮮度或經濟性判在 ★4，必須說明 ★5 屬設計性天花板（要求 CI gate，撞 Blocker #3），
   而不是列成一般失分點叫使用者去修。

這個 case 是**偽陽性**的守門員。前兩個 case 逼 docgrad 抓錯，這個 case 確認它不會為了抓錯
而把乾淨的文件也扣分——沒有這條，提高敏感度的每一次修改都可能悄悄變成到處誤報。
