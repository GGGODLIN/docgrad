# improve / loop — 收斂輪

> **Last updated:** 2026-09-13

`improve`＝跑一輪就停；`loop`＝反覆跑到停止條件。流程完全相同。

## 前置 blockers

1. 無 `.docgrad.yml` → 停，導向 `/docgrad init`。
2. 尚未讀 [rubric.md](rubric.md) → 先讀。
3. 目標 repo 工作區有未提交變更（非 docgrad 產生）→ 停，請使用者處理後再跑。

## Branch 紀律

- 一律在 `docgrad/converge` branch 工作：不存在 → 從目前 branch 建立；已存在 → checkout 續跑（中斷可續）。
- 只 commit docs 變更與 `.docgrad/` 狀態檔——「docs 變更」＝ `.docgrad.yml` 的 `docs_dirs`／`docs_files`／
  `entry_files` 涵蓋的檔案，**不含 source code 檔**（含其註解）。**絕不碰目標 repo 的 CI 設定。**
- branch 隔離讓使用者可整批 review 再合併；每輪一 commit 保證可回退。

## 每輪步驟

1. **評分**：依 [audit.md](audit.md) 全量評分（腳本＋LLM），得本輪 scorecard。
2. **挑維度**：取最低分維度；同分 → 取 rubric 順序靠前者
   （完整性 → 正確性 → 新鮮度 → 連結度 → 一致性 → 經濟性）。
   已判**設計性天花板**（見停止條件）的維度不列入挑選，取次低者。
   **一輪只修這一維**——收斂不是重寫，全量改一半會留下矛盾。兩個例外，都要在報告寫明：

   - **trivial-fix 白名單**：死鏈修復、孤兒補進索引、錯字級一致性，**任何輪次都可順手修**，
     只需列進 commit message。理由：這三類有全量機械驗證（腳本重跑即知），不存在
     「改一半留矛盾」的風險，而規則擋著它們只是把零風險的修正推到下一輪。
   - **小語料模式**：`inventory.totals.tokens_est` < 10,000 或 `totals.files` < 5 時，
     允許單輪多維，報告標注「小語料模式：本輪修 N 維」。理由：dream-calm-true 只有兩份
     文件，一輪一維在那裡純粹是輪次開銷——它的 scorecard 自己記著「install 兩法可統一，
     但改它會違反一輪只修一維」，一個兩行的零風險修正就這樣被推了出去。

   兩個例外都不豁免步驟 4 的驗證：任一維下降照樣 revert。
   選中**一致性**時再細分一層：一輪只修一類失分，依 `[矛盾]` → `[重複]` → `[落點]` 排序
   （矛盾讓 agent 讀到錯的事實、危害最大；重複是矛盾的溫床；落點只是取用效率）。
   搬動資訊落點會動到 code 註解／spec，比改 docs 風險高——排最後，且該輪不得同時修其他類。
3. **修**：從該維失分點逐條生成 focused 修改並執行：
   - 機械修正直接做：死鏈修復、孤兒補進索引、日期 backfill——一律用
     `git log -1 --format=%as -- <file>` 的真實日期，**禁止捏造日期**。
   - 語意修正也做，但必須在 commit message 列清單：合併冗餘文件、敘述改寫為
     refer-to-code、刪檔、補缺口文件。
   - **經濟性的修法**：唯一機械可行的兩條路是「把入口檔的內容搬出去、只留指路」與「把 WIP／
     歷史包袱移出語料（`exclude` 或刪檔）」。前者是搬移不是刪減——**內容要搬到 `docs_dirs` 內
     並從索引連得到**，否則完整性與連結度會一起掉，驗證步驟會擋下來。
     **禁止為了降成本而刪掉仍然正確、仍被需要的內容**；真的只剩「刪了才降得下來」時，
     判 plateau 並把取捨攤給使用者，不要自行決定砍哪一份文件。
     `entry_files` 設定本身錯了（列了不進 agent context 的檔、或漏列必讀檔）→ 改 `.docgrad.yml`
     並在 commit message 明示，這算設定修正不算刷分。列進去的檔其實是**條件式**載入時，
     改列 `docs_files`（仍在語料內、不計固定成本），**不要**直接刪掉——刪掉會同時掉完整性。
   - **落點類的界線**：只動 docs 範圍內的檔案（entry file ↔ docs、docs ↔ docs 的搬移照做）。
     要把資訊搬進 code 註解或其他 source 檔的建議**一律不自動執行**——那超出「只 commit docs 變更」
     的 branch 紀律，且五支腳本驗證不到 code 註解，改了也無從確認沒改壞。這類失分點改寫進本輪報告的
     「建議由人處理」清單並記入 notes；若一致性因此連兩輪無進步，判**設計性天花板**而非 plateau。
4. **驗證**：重跑腳本＋受影響維度重評。成功＝目標維上升且其他維不降。
   任何維度下降 → revert 造成下降的修改，記入 notes。
5. **記錄＋commit**：
   - append 一行到 `.docgrad/history.jsonl`（無則建立）。`docgrad_version` 與 `rubric_hash`
     **直接抄 `inventory.mjs` 輸出的 `docgrad` 區塊**，不要自己填：

     ```json
     {"round": 3, "date": "2026-07-12", "dimension": "linkage", "docgrad_version": "1.1.0", "rubric_hash": "b6e4f7f3", "scores": {"completeness": 4, "correctness": 3, "freshness": 4, "linkage": 4, "consistency": 4, "economy": 4}, "coverage": {"claims_verified": 23, "claims_total": 68}, "notes": "修 12 死鏈；2 孤兒併入索引"}
     ```

     兩個版本欄位是給 `report` 畫可比性斷點用的：`rubric_hash` 一變代表尺換了，
     前後分數不可直接比較。缺欄位的舊紀錄視為 unknown，不阻擋。
   - append 本輪驗證過的 claim 到 `.docgrad/ledger.jsonl`（無則建立）。**累積、只增不重寫**——
     重驗舊條目時 append 新一行（帶新的 `round`），不要改舊行，這樣才看得出某條宣稱何時壞、何時修好：

     ```json
     {"claim_id": "docs/x.md:75", "round": 3, "doc": "docs/x.md", "line": 75, "claim": "路由定義在 src/router.ts", "verify": "Read src/router.ts", "result": "pass", "verified_at": "2026-07-12"}
     ```

     `claim_id` ＝ `<path>:<line>`。文件重排導致行號漂移時，以宣稱內容為準沿用舊 `claim_id`
     並在該行加 `"moved_from": "<舊 id>"`，不要當成新 claim——那會讓累積覆蓋率虛增。
   - 覆寫 `.docgrad/scorecard-latest.md`（audit.md 的 scorecard 全文）。
   - commit（zh-TW）：

     ```
     docs(docgrad): 第 N 輪收斂 — <維度> ★x→★y

     語意修改：
     - 合併 a.md 與 b.md（重疊主題）
     - …（無則省略此段）

     scorecard: 完整性★x 正確性★x 新鮮度★x 連結度★x 一致性★x 經濟性★x
     ledger: 累積覆蓋 m/N（本輪新驗 a、重驗 b）
     ```

## 維度封頂：設計性天花板

某維的下一星錨點落在 Blocker 禁區 → 該維判「docgrad 範圍內已收斂（上限 ★x）」：不再列入挑維度、
達標判定時視同已達標、在收官報告與畢業建議點名它與其原因。**這不停 loop**，只是把該維移出工作集。

目前有兩例，性質相同（★5 錨點都要求機械 gate，而 Blocker #3 明訂不碰目標 repo 的 CI），
且都只在該維 target 設為 5 時撞到，預設 target ★4 不受影響：

- **新鮮度 ★5**：要求「同 MR 隨改隨更有機械 gate 強制」→ loop 內上限 ★4。
- **經濟性 ★5**：要求「入口檔 token 預算有機械 gate 強制」→ loop 內上限 ★4。

**與 plateau 的區別**：plateau＝修得動、但這兩輪沒修出成績，再跑有機會；設計性天花板＝設計上不可達，
再跑幾輪也不會動。判成 plateau 會讓報告誤導使用者「多跑幾輪試試」，所以先判天花板再判 plateau。

## 停止條件（loop；任一成立即停）

- ✅ **達標**：每個維度皆「≥ `.docgrad.yml` targets」或「已判設計性天花板」→ 收官報告＋畢業建議（見下）。
- ⏸ **plateau**：連續兩輪所有維度分數皆無進步（已封頂維不計入）→ plateau 報告：卡在哪一維哪些失分點、
  為何 docgrad 修不動（例：需要補寫領域知識、需要人定奪的取捨）。
- ⏸ **需人裁決**：兩份文件互斥且 code 無法仲裁，或修正涉及產品決策 → 列出選項
  （A/B＋各自後果與建議），暫停等使用者裁決後再續。

`improve` 單輪跑完直接停，輸出本輪 scorecard 與 diff 摘要。

## 畢業（達標收官時做，不是只寫建議）

**為什麼這節有交付物**：沒有 gate 的收斂會自然衰減。oikos 收官**當天**就冒出新孤兒
（`utm-convention.md`）與缺 `last_updated` 的檔案，coverage 95.1% → 90.7%；兩個月後
仍在原地沒人回收。散文式的「建議自建 CI」沒有交付物，所以沒有人執行。

Blocker #3「不碰 CI」的意思是**不自動改動使用者的 CI**，不是不得產出 CI 素材。

達標收官時做兩件事：

1. **產出，但不安裝**。把 `$SKILL_DIR/templates/` 的兩支複製到目標 repo 的
   `.docgrad/graduation/`，並依該 repo 的實況調整 `THRESHOLDS`（現況值即門檻，
   讓 gate 一開始就是綠的，之後只准更嚴）：

   ```bash
   mkdir -p .docgrad/graduation
   cp "$SKILL_DIR/templates/docs-gate.mjs" "$SKILL_DIR/templates/docs-gate.yml" .docgrad/graduation/
   ```

   **絕不寫入 `.github/`**，也不改動任何既有 CI 設定。

2. **報告固定附上這段**（路徑要填實際值）：

   > 已產出 `.docgrad/graduation/docs-gate.mjs` 與 `docs-gate.yml`，**未安裝**。
   > 要啟用：把 `.mjs` 放到 `.github/scripts/`、`.yml` 放到 `.github/workflows/`，
   > 兩者都已按本 repo 現況設好門檻。gate 只擋死鏈／壞錨／孤兒／新鮮度覆蓋率／
   > 入口檔 token 預算——嚴格度由團隊決定，docgrad 不替你決定。
   >
   > 死鏈與格式也可改用更成熟的現成工具（lychee 或 markdown-link-check、markdownlint、
   > Vale）。docgrad 腳本的差異化價值在孤兒／可達性與入口檔 token 預算——這兩個是
   > 「文件作為 agent context」特有的量測，一般 docs linter 不做。

有維度因設計性天花板封頂時，本節要點名它：該維要再上一星只能靠這道 gate
（新鮮度 ★5 ＝「docs 與 code 同 MR 更新」；經濟性 ★5 ＝「入口檔 token 預算」），
並說明目前上限星等。

## 職權外發現的出口

docgrad 不動 code、不碰 CI，但評分過程一定會撞到那些東西（oikos round 3 抓到
`lib/supabase/server.ts` 的 docstring stale，只能寫進 notes，兩個月後還在原地）。
自然語言的 notes 沒有任何東西會去追蹤它，於是每輪都在生產不會被處理的尾巴。

發現落在職權外時，append 一行到 `.docgrad/out-of-scope.jsonl`（無則建立，只增不重寫）：

```json
{"round": 3, "kind": "code-comment", "path": "lib/supabase/server.ts", "line": 42, "claim": "docstring 仍寫 without an Auth API round-trip，v1.0.2 起已非事實", "suggested_action": "改 docstring；docgrad 不動 code", "status": "open"}
```

- `kind`：`code-comment`／`ci`／`product-decision`／`other`。
- 後續輪次確認已被處理 → append 同一筆但 `status: "resolved"`，不要改舊行。
- **收官報告必須列出所有 `status: open` 的項目與筆數**，不能只寫在當輪的 notes 裡。
- 使用者要求時可代為 `gh issue create` 逐條開票——**需明確確認後才執行**。
