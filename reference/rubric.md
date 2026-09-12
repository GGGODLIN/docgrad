# docgrad rubric — 六維星等錨點

> **Last updated:** 2026-09-13

> 本檔是跨輪分數可比性的唯一依據。錨點寫死；任何修改都會讓歷史分數失去可比性，
> 屬 breaking change，必須在 commit message 明示。

## Contents

- [評分總則](#評分總則)
- [機械訊號 → 維度對照](#機械訊號--維度對照)
- [完整性 completeness](#完整性-completeness)
- [正確性 correctness](#正確性-correctness)
- [新鮮度 freshness](#新鮮度-freshness)
- [連結度 linkage](#連結度-linkage)
- [一致性 consistency](#一致性-consistency)
- [經濟性 economy](#經濟性-economy)
- [Token 經濟報告](#token-經濟報告)
- [版本沿革與可比性註記](#版本沿革與可比性註記)

## 評分總則

1. 先跑五支腳本（inventory / links / freshness / coverage / retrieval），機械訊號可重現。
2. LLM 判斷維度（完整性、正確性、一致性）依本檔錨點對號入座，禁止自創標準。
3. 星等取整數 ★1–★5；取「完全滿足」的最高一級。
4. 拿不準時往低取——保守評分讓 loop 有明確的工作方向。
5. 維度固定順序（同分 tie-break 取靠前者）：完整性 → 正確性 → 新鮮度 → 連結度 → 一致性 → 經濟性。
   經濟性排最後是刻意的：它與完整性方向相反（補文件會推高固定成本），同分時先讓內容維度動，
   避免 loop 在「補了又刪」之間來回。

## 機械訊號 → 維度對照

| 腳本 | 餵給 |
|---|---|
| inventory.mjs | **經濟性（全量機械：`entry_cost` ＋ `pollution`）**；完整性的盤點基礎；`structure.rules` 餵可回溯性 |
| coverage.mjs | 完整性（覆蓋漂移：undocumented/drifted 區域） |
| links.mjs | 連結度（全量機械） |
| freshness.mjs | 新鮮度（機械為主） |
| retrieval.mjs | 邊際成本（`scenarios:` 有設時）＋可回溯性——**皆 report-only，不參與經濟性定星** |
| （無腳本） | 正確性、一致性（LLM claim-ledger／跨文件三角驗證） |

## 完整性 completeness

| 星 | 錨點 |
|---|---|
| ★1 | 核心模組大多無文件；agent 只能直接讀 code 反推。 |
| ★2 | 有零散文件，但部署、測試、資料模型至少一個關鍵領域整塊缺失。 |
| ★3 | 核心領域皆有權威文件；部署/測試至少有內嵌敘述。 |
| ★4 | 領域全覆蓋，常見任務有 how-to；僅少數邊緣模組缺。 |
| ★5 | 全覆蓋＋runbook＋onboarding 路徑＋退役機制明確標註「勿用於新功能」。 |

量測：coverage.mjs 的 undocumented/drifted 區域清單為機械基礎（src_dirs 未設定時降級為純 LLM 對照），LLM 再掃 src 頂層結構與部署/測試設施補判腳本看不到的缺口（如子系統粒度、mentioned_by 誤判）。undocumented/drifted 區域視同該領域缺權威文件。

## 正確性 correctness

| 星 | 錨點 |
|---|---|
| ★1 | 抽查通過率 <50%，含機制性錯誤（描述的架構已不存在）。 |
| ★2 | 通過率 50–79%，或有整份文件描述已退役機制且無任何標註。 |
| ★3 | 抽查通過 ≥80%；錯的是細節不是機制。 |
| ★4 | 抽查通過 ≥90%，且無殭屍機制文件。 |
| ★5 | 抽查全過＋殭屍代碼/已退役機制有標註＋權威列表 refer-to-code 不複述。 |

量測：claim-ledger——抽 `correctness_sample` 條具體宣稱，逐條對 code 驗證（見 [audit.md](audit.md) 步驟 3）。
**抽樣由腳本決定**：母體＝`inventory.totals.claims_total`（fence 外、帶得到 code 座標的非標題行），
取用序＝`inventory.claim_candidates`（依 ref 數 → path → line 穩定排序），同一文件最多 2 條。
既有 `.docgrad/ledger.jsonl` 的條目先重驗（fail/stale 全驗、pass 抽半數）再抽新樣本，ledger 累積不重抽。

> **通過率與覆蓋率要分開報**：本維星等看**通過率**（pass ÷ 本輪驗證數）；
> **累積覆蓋率**（ledger 相異 claim ÷ `claims_total`）不影響星等，但**報告必須附上**——
> 通過率 8/8 在覆蓋 5% 與覆蓋 60% 下是兩回事，只給星等會讓讀者高估這個數字的可信度。

## 新鮮度 freshness

| 星 | 錨點 |
|---|---|
| ★1 | 無日期訊號慣例（coverage_ratio <20%）。 |
| ★2 | 訊號零散（20–60%），或關鍵文件 staleness >180 天。 |
| ★3 | 有日期訊號慣例但靠自律；關鍵文件 staleness ≤60 天。 |
| ★4 | 覆蓋 ≥90%，mismatch 僅零星且 drift <30 天。 |
| ★5 | 全覆蓋＋「同 MR 隨改隨更」有機械 gate 強制＋生命週期管理（superseded 即處理）。 |

量測：freshness.mjs 的 coverage_ratio / stale / mismatches；「關鍵文件」＝entry_files＋index_file＋各領域權威文件。
git 日期比對**排除 docgrad 自己的收斂 commit**（`docs(docgrad):` 前綴），取最近一筆非 docgrad commit——
否則 backfill 那一輪會把自己的 commit 日期算成「內容有更新」而產生假 mismatch。
`date_concentration` 為提示欄位（**不影響星等**）：同一天佔比過高代表訊號集中於單次 backfill，
覆蓋率數字不代表維護實況，報告要註明。

> **★5 的適用範圍（graduation-only）**：★5 要求的「機械 gate 強制」得動 CI，而 improve/loop 受
> Blocker #3 約束不碰目標 repo 的 CI —— 故 loop 內新鮮度上限為 ★4，該維會判設計性天花板
> （見 [improve.md](improve.md)），★5 屬畢業後由團隊自建 docs-gate CI 才達成的範圍。
> 此為可達性說明，**不改動 ★1–★5 任何判定門檻**（見 [§版本沿革](#版本沿革與可比性註記)）。

## 連結度 linkage

| 星 | 錨點 |
|---|---|
| ★1 | 死鏈比例 >10%，或完全沒有索引。 |
| ★2 | 死鏈 2–10%，或孤兒 >20%。 |
| ★3 | 相對連結失效 ≤2%；有索引但非唯一入口。 |
| ★4 | 零死鏈、孤兒 ≤5%、reachable_ratio ≥95%。 |
| ★5 | 零死鏈＋單一頂層索引 transitive 全可達（零孤兒）＋錨點用 `path › symbol()` 抗行號漂移。 |

量測：links.mjs 全量機械輸出（死鏈比例＝dead_links / total_links）。壞錨一律扣星；`cjk_uncertain` 僅為提示欄位，**不是**跳過確認的理由（見 [§版本沿革](#版本沿革與可比性註記)）。

## 一致性 consistency

| 星 | 錨點 |
|---|---|
| ★1 | 同主題多處矛盾且無仲裁線索。 |
| ★2 | 重疊多處，至少一組實質矛盾。 |
| ★3 | 同主題重疊 ≤2 處且互不矛盾。 |
| ★4 | 一主題一權威為主，個別重疊處有互鏈。 |
| ★5 | 一主題一權威（其餘只留摘要＋連結）＋衝突仲裁慣例明文（newer wins＋以 code 仲裁）。 |

量測：LLM 挑 3–5 個關鍵事實主題（架構、狀態機、部署方式…）做跨文件比對＋以 code 三角驗證；
判定範圍**含 docs ↔ code 註解／spec 之間的落點與重複**——規則見 [placement.md](placement.md)，
只判落點與重複，不評註解品質。失分點分 `[矛盾]`／`[重複]`／`[落點]` 三類（見 [audit.md](audit.md) 步驟 6）。
跨 v0.5.0 比較本維分數時，判定範圍已擴大（見 [§版本沿革](#版本沿革與可比性註記)）。

## 經濟性 economy

| 星 | 錨點 |
|---|---|
| ★1 | 固定成本 > 20,000 tokens。 |
| ★2 | 固定成本 > 10,000 且 ≤ 20,000。 |
| ★3 | 固定成本 > 5,000 且 ≤ 10,000。 |
| ★4 | 固定成本 ≤ 5,000 且污染面 < 10%。 |
| ★5 | 固定成本 ≤ 3,000、污染面 < 10%，且入口檔 token 預算有機械 gate 強制。 |

量測：**固定成本**＝`inventory.entry_cost.tokens_est`（`entry_files` 每次任務都載入的稅，
symlink 別名已去重）；**污染面**＝`inventory.pollution.ratio`。兩者皆全量機械，不經 LLM 判斷。

> **污染面的降級規則**：污染面 ≥ 10% 時，無論固定成本多低，本維上限 ★3。
> 沒有這條，「固定成本 4,000＋污染面 15%」會同時不滿足 ★3（成本太低）與 ★4（污染面太高）而無星可定。

> **本維與完整性方向相反，這是設計而非缺陷**：補文件會推高固定成本。經濟性的作用就是讓 loop
> 在「文件更多」與「agent 更貴」之間有一個機械的煞車——外部實證（多個 coding agent 在 SWE-Bench Lite
> 與 AgentBench 上的對照）指出 context 檔變長會提高成本而未必提高成功率，故覆蓋率不能是唯一的獎勵方向。
> 實作上靠三件事避免來回拉鋸：經濟性排維度順序最後（同分先讓內容維度動）、`entry_files` 以外的文件
> 不計入固定成本（把內容搬出入口檔即可同時滿足兩維）、以及 improve 的「其他維不得下降」驗證。

> **★5 的適用範圍（graduation-only）**：★5 要求的「機械 gate 強制」得動 CI，而 improve/loop 受
> Blocker #3 約束不碰目標 repo 的 CI —— 故 loop 內經濟性上限為 ★4，該維會判設計性天花板
> （見 [improve.md](improve.md)），與新鮮度 ★5 同一性質。

## Token 經濟報告

自 v1.0.0 起，**固定成本與污染面已計星**（見 [§經濟性](#經濟性-economy)）；本節是該維的展開說明，
外加兩項仍為 report-only 的訊號（邊際成本、可回溯性）——它們不參與定星。

- **固定成本**：`inventory.entry_cost.tokens_est`（entry_files 每次任務都載入）。**計星**。
- **邊際成本**（report-only）：有 `.docgrad.yml` 的 `scenarios:`（代表性 code 路徑清單）時，由 `retrieval.mjs` 機械計算——
  每條 scenario 報 `marginal_tokens`（entry_files＋索引鏈上經過的 doc＋所有錨定 doc 的 tokens，各檔只算
  一次）／`max_depth`（從 `index_file` 到最遠一份錨定 doc 要幾跳）／`fan_in`（錨定它的 doc 數）／
  `code_pointer`（該路徑的 code 有沒有指回任一 docs），並以 `churn_commits`（近 90 天 commit 數）加權指出
  「稅最重」的那條 scenario——churn 高又 marginal_tokens 高／max_depth 深，代表 agent 常碰但檢索成本也
  最高，優先改善。沒有 `scenarios:` 時退回舊法：LLM 依 `.docgrad.yml` 的 `scenario`（單數，敘事字串）
  模擬必讀路徑。
- **污染面**：`inventory.pollution.ratio`（exclude 目錄與 WIP 佔全語料比例）。**計星**。
- **解讀**：報告必附「損益兩平」說明——入口檔塞太多＝每個任務都付固定稅；全靠索引指路＝多跳檢索的邊際成本。按該 repo 的任務組成給權衡建議。

### 可回溯性（report-only）

新增訊號，量「從 code 檔案回到管它的 spec 有沒有路、那份 spec 好不好用」——**不影響 ★1–★5 任何錨點**，
只是 Token 經濟報告的延伸小節。機械基礎＝`retrieval.mjs`（`code_pointer_ratio`／`index_hotness`）與
`inventory.mjs`（`structure.rules`）。

- **`code_pointer_ratio`**（retrieval.mjs `areas[].code_pointer` 彙總）：`src_dirs` 各一級子目錄底下的
  code 有沒有任何一份指回 docs（`docs_dirs` 前綴字串或某份 doc 的 basename）。低比例＝agent 改完 code
  找不到回 spec 的路，只能整包搜文件樹猜。
- **`index_hotness`**（retrieval.mjs）：`index_file`／`entry_files` 近 90 天 commit 數 vs 全部 docs 的
  中位數。`ratio` 明顯 >3 通常是索引/入口檔混進了該由子文件自己揭露的內容——索引該改成「指路」而非
  「跟著內容一起被改」；也可能只是單純孤兒維護債，讀 `top5` 判斷。
- **`structure.rules`**（inventory.mjs，每檔）：規則行（`rules.pattern` 判定，預設 `**MUST`）的
  `median_chars`／`p90_chars`／`anchored_ratio`。中位數 >300 字或 `anchored_ratio` <0.5 建議把該檔拆成
  「契約層」（規則本身，短、帶座標）＋「細節層」（背景、案例，可長）——長規則行混雜背景敘述會讓 agent
  每次都要整段讀完才找得到那句真正的 MUST，帶座標低則代表宣稱缺乏可驗證的 code 落點。

## 版本沿革與可比性註記

只在比較跨版本分數時需要讀；日常評分不必展開。下列任一項都**沒有改動既有維度的 ★1–★5 錨點文字**；
唯一的 breaking 是 v1.0.0 新增一個維度（維度組成變了，各維自身的尺沒變）。

<details>
<summary>展開</summary>

- **v1.3.0 — 新鮮度的 git 比對排除 docgrad 自己的 commit**（非錨點變更）：★1–★5 門檻未動，
  但 mismatch 的計算基準改了——backfill 輪次不再自我污染。跨 v1.3.0 比較新鮮度分數時，
  舊分數可能含假 mismatch 而偏低（oikos round 2 實測 38 筆）。新增提示欄位 `date_concentration`，
  report-only。
- **v1.1.0 — 正確性抽樣改為機械決定**（非錨點變更）：★1–★5 門檻（通過率 <50%／50–79%／≥80%／
  ≥90%／全過）一字未動，變的是**抽哪些**——從逐輪由 LLM 自由挑，改成消費 `inventory.claim_candidates`
  的穩定排序，並先重驗既有 ledger。跨 v1.1.0 比較正確性分數時要知道：舊分數的樣本不可重現，
  新分數的可以。同時報告新增「累積覆蓋率」（report-only，不影響星等）。
- **v1.0.0 — 新增第六維「經濟性」**（**breaking，rubric 結構變更**）：固定成本與污染面從
  report-only 升格為計星維度。五維時代的 `history.jsonl` 缺 `economy` 鍵，**跨 v1.0.0 的總體分數
  不可比**，受影響 repo 的收斂輪應從基線重新起算（舊紀錄保留，`report` 在此處畫斷點）。
  ★1–★5 在**既有五維**上的錨點文字一字未動——不可比的是「達標與否」與維度組成，不是各維自身的尺。
- **v0.5.0 — 一致性判定範圍擴到跨載體**（非錨點變更）：範圍從「docs 內部」擴到含 docs ↔ code 註解／spec
  的落點與重複。原本 ★5 的 repo 可能因 code 註解與 docs 各自展開同一事實而下修。★1–★5 錨點文字未動，
  但跨 v0.5.0 比較一致性分數時要在報告註明範圍已擴大——這與 0.2.0 完整性改以 coverage 為機械基礎
  是同一種變更。
- **0.2.0 — 完整性改以 coverage.mjs 為機械基礎**（非錨點變更）：原為純 LLM 對照。
- **0.6.1 — 連結度壞錨誤報修正**（非錨點變更）：`githubSlug()` 與 GitHub 逐字對齊後，CJK 標題不再有
  近似誤差，`cjk_uncertain` 從「先人工確認再計入」的例外降為提示欄位，壞錨一律扣星。0.6.1 之前的
  連結度分數可能因誤報而偏低。
- **新鮮度 ★5 的 graduation-only 註記**：只說明 loop 內的可達性上限（Blocker #3 不碰 CI），
  不改動 ★1–★5 任何判定門檻，歷史分數可比性不受影響。

</details>
