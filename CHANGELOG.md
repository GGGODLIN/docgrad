# Changelog

版本權威在 [.claude-plugin/plugin.json](.claude-plugin/plugin.json) 的 `version`；本檔記錄各版變更。
版號語意（semver，docgrad 特化）見 [docs/how-to.md](docs/how-to.md) §發版。

## 1.1.0 — 2026-09-13

正確性的抽樣從「每輪由 LLM 自由挑」改成機械決定並累積落檔，history 補上版本指紋。
**既有 ★1–★5 錨點文字一字未動**——變的是抽哪些、以及分數旁邊附什麼數字。

- **修正（#12）正確性分數不可重現**：2026-07-13 oikos 收官後同日重驗，一致性 ★4→★2
  （`transactions-design.md` 的 balance 正負號與 `lib/balance.ts` 相反，「前四輪抽樣未覆蓋」）。
  根因不是錨點不夠細，是**抽樣沒被約束**——錨點再細也管不到「抽哪些」。
  - **抽樣母體與取用序改由腳本產出**：`inventory.mjs` 新增 `totals.claims_total`
    （fence 外、帶得到 code 座標的非標題行）與 `claim_candidates`（依 ref 數 → path → line
    穩定排序，取前 60）。同一份語料每次跑出的順序完全相同（已加測試驗證）。
  - **ledger 累積落檔**：`improve`／`loop` 每輪 append `.docgrad/ledger.jsonl`
    （`claim_id`＝`<path>:<line>`、只增不重寫，重驗時 append 新一行，看得出何時壞何時修好）。
    行號漂移時沿用舊 `claim_id` 並標 `moved_from`，避免累積覆蓋率虛增。
  - **下一輪先重驗再抽新**：`fail`／`stale` 全部重驗，`pass` 抽半數（依 `claim_id` 排序取偶數位，
    可重現）。`audit` **讀** ledger 但不寫——與「audit 純報告不落檔」的鐵則一致。
  - **報告改為「星等＋覆蓋率」**：`正確性 ★4（通過率 8/8，累積覆蓋 23/68 ＝ 34%）`。
    通過率 8/8 在覆蓋 5% 與 60% 下是兩回事，只給星等會讓讀者高估可信度。覆蓋率不影響星等。
  - scoped audit 下**不可報**累積覆蓋率（分母被 `--include` 縮過，與全量不同義），ledger 照讀不寫。
- **新增（#16）history 的版本指紋**：每行補 `docgrad_version` 與 `rubric_hash`
  （`reference/rubric.md` 內容的 sha256 前 8 碼），由 `inventory.mjs` 的新 `docgrad` 區塊提供，
  不由 LLM 自己填。`report` 在 `rubric_hash` 改變處畫可比性斷點——修掉「尺變了卻被畫成品質退步」
  （本 repo round 9 的一致性 ★5→★4 就是這種情況，當時只能寫在 notes 的自然語言裡）。
  缺欄位的舊紀錄視為 unknown，不阻擋。
- **新增（lib）**：`docgradMeta()`（版本＋rubric 指紋，讀不到檔時回 `null` 不丟錯）、
  `extractClaimLines()`、`rankClaimCandidates()`。
- **`report`**：有 `.docgrad/ledger.jsonl` 時一併報累積覆蓋率與目前仍為 `fail`／`stale` 的宣稱。
- **測試**：59 → 63（rubric 指紋會隨內容變、缺檔回 null、claim 行抽取排除 fence/標題、候選排序穩定）。

## 1.0.0 — 2026-09-13

> ### ⚠️ BREAKING — rubric 結構變更，歷史分數需重新起算
>
> 新增第六維**經濟性**。各 repo `.docgrad/history.jsonl` 的舊紀錄缺 `economy` 鍵，
> **跨 1.0.0 的「達標與否」與總體分數不可比**，收斂輪應從基線重新起算（舊紀錄保留，不要刪）。
> **既有五維的 ★1–★5 錨點文字一字未動**——不可比的是維度組成，不是各維自身的尺。
>
> 升級動作：對每個已導入的 repo 重跑 `/docgrad audit` 取得六維基線；`.docgrad.yml` 不改也能跑
> （`targets.economy` 與 `economy.*` 未設時走預設），想調目標才需補欄位。

- **新增（維度）經濟性 economy**（issue #11）：固定成本與污染面從 report-only 升格為計星維度。
  - 錨點：★1 固定成本 > 20,000 tokens／★2 > 10,000 ≤ 20,000／★3 > 5,000 ≤ 10,000／
    ★4 ≤ 5,000 且污染面 < 10%／★5 ≤ 3,000、污染面 < 10% 且入口檔 token 預算有機械 gate 強制。
  - 降級規則：污染面 ≥ 10% 時本維上限 ★3（否則「成本低但污染重」會落在錨點縫隙裡無星可定）。
  - 全量機械（`inventory.mjs` 的 `entry_cost.tokens_est` 與 `pollution.ratio`），不經 LLM 判斷。
  - **★5 判設計性天花板**：要求的機械 gate 得動 CI，撞 Blocker #3 → loop 內上限 ★4，
    與新鮮度 ★5 同一性質（`reference/improve.md` §維度封頂現有兩例）。
  - 維度順序排最後：它與完整性方向相反（補文件會推高固定成本），同分時先讓內容維度動，
    避免 loop 在「補了又刪」之間來回。
- **為什麼加維度而不是只報告**：完整性獎勵覆蓋，只報不計星時 loop 每一輪的合法動作都是「補文件」，
  沒有任何力量把不值得它的 token 的內容搬出入口檔。外部實證（多個 coding agent 在 SWE-Bench Lite
  與 AgentBench 上的對照）指出 context 檔變長會提高成本而未必提高成功率。加維度的代價
  （major＋歷史重算）是知情下付的——對比 0.5.0 一致性擴範圍時刻意**不**加第六維：那次改的是既有
  維度的判定範圍，這次改的是獎勵方向本身。
- **`improve` 的經濟性修法有護欄**：只允許「把入口檔內容搬出去、只留指路」與「把 WIP／歷史包袱移出
  語料」。搬移必須落在 `docs_dirs` 內且從索引連得到，否則完整性／連結度會掉、驗證步驟會擋下。
  **禁止為降成本刪掉仍然正確、仍被需要的內容**；只剩「刪了才降得下來」時判 plateau，取捨攤給使用者。
- **`report` 的斷點處理**：缺 `economy` 鍵的輪次屬五維時代，該維畫 `—`，走勢表在該處畫斷點線並註明
  不可與新輪次相比。
- **設定**：`targets.economy`（預設 4）與 `economy.entry_cost_tiers`／`economy.pollution_max`
  （預設 `[20000, 10000, 5000, 3000]`／`0.1`）。未設時走預設，既有 repo 不必重跑 `init`。
  改門檻＝改 rubric 錨點＝歷史分數失去可比性，`init` 已明示「寧可降 target 也不要改門檻」。
- **`init` 問卷**：`entry_files` 補上判準說明——「agent 每次任務都會自動載入」而非「重要」。
  給人看的 GitHub 落地頁列進去就是憑空多付的固定稅（本 repo 自己踩過，見 0.6.2 的 #22）。
- **scoped audit**：經濟性**不可在 scoped 下定星**（固定成本與污染面都是全量概念），
  報「不適用（需全量 audit）」，不可因此打 ★1——同連結度的孤兒／可達率。
- **測試**：59（新增 `targets.economy` 與 `economy.*` 的預設值斷言）。

## 0.6.2 — 2026-09-13

跨專案回顧（oikos／dream-calm-true／本 repo／kdan-bpm）＋對照 Anthropic 官方 skill authoring
best practices 後的結構修正。**不改動任何星等錨點語意，歷史分數可比性不受影響。**

- **修正（#20）文件內部不一致**：四處仍寫「四支腳本」，`retrieval.mjs` 自 0.6.0 起是第五支。
  - `reference/rubric.md` 評分總則第 1 條、`reference/improve.md` 兩處（落點界線、畢業建議）改為五支。
  - `reference/audit.md` §scoped audit「四支腳本加 `--include`」是雙重錯誤：只有
    inventory／links／freshness 吃該旗標，coverage／retrieval 刻意不吃（`SKILL.md` 已明載）。改為三支並寫明。
- **修正（#21）引用層級與長檔目錄**：官方要求 reference 檔一律自 SKILL.md 一層可達、>100 行需附 Contents。
  - `reference/placement.md` 原本只能經 rubric.md／audit.md 到達（第二層），而它是一致性維度
    落點／重複的判定依據。Blocker #2 新增一句直接點名，改為一層可達。
  - `docs/design.md`（161 行）、`reference/audit.md`（151 行）、`reference/rubric.md`（126 行）補 Contents。
- **修正（#24）rubric 正文瘦身**：版本沿革改收進檔末 `<details>` 的「版本沿革與可比性註記」，
  正文各維量測欄留一行指路。rubric.md 是 Blocker #2 強制必讀，每次評分都要付它的 token；
  版本沿革只在跨版本比較分數時才需要。
  - **錨點表與量測方式一字未動**，僅移動歷史註記。新鮮度 ★5 的 graduation-only 說明屬**現行規則**
    （improve.md 的設計性天花板依賴它）而非沿革，故留在正文，只把可比性那句移入 details。
  - 一併補記 0.2.0（完整性改以 coverage 為機械基礎）到沿革清單。
- **修正（#26，lib）`collectFiles()` 漏收 `index_file`**：`index_file` 落在 `docs_dirs` 之外且不在
  `entry_files` 時不進語料，於是被 `links.mjs` 的 roots 過濾掉（roots 只認語料內路徑），
  **整棵只從索引可達的子樹被誤判成孤兒**，`reachable_ratio` 一併下修且無任何 note。
  索引本來就是文件體系的一部分，改為比照 `entry_files` 補進語料。
  - 受影響：把索引放 repo 根的 repo——這些 repo 過去的連結度星等**偏低**，失分點還會指向沒問題的檔案。
    `index_file` 在 `docs_dirs` 內者數字不變。
  - 回歸測試：新增 `tests/fixtures/root-index/`，已驗證未修復時為紅。
- **修正（#22）本 repo 自身 `.docgrad.yml` 誤報固定成本**：`entry_files` 原含 `README.md`，
  但它是 GitHub 落地頁、不進 agent context。移除後固定成本 2,823 → **1,047 tokens**（原值灌水 1.7 倍）。
  一併補 `src_dirs: [scripts/]` 與 `scenarios:`，讓 coverage／retrieval 脫離降級模式。
- **修正（#23）frontmatter**：`license` 改為合法 SPDX 標識 `MIT`（原值 `MIT. See NOTICE.md for
  attribution.` 混入說明文字）；移除 `user-invocable: true`（該欄位預設即為 true，用途是設成 false）。
  - **未採用 `allowed-tools`**：Bash 規則第一個 `*` 之前必須逐字相符，而 skill 撰寫時不知道自己的
    安裝絕對路徑；唯一可攜的 pattern 是 `Bash(node *)`，等於預先放行任意 node 指令。改為在
    `docs/how-to.md` 教使用者用自己的絕對路徑加規則。
- **驗證**：`node --test tests/*.test.mjs` **59 pass**；本 repo dead 0／bad_anchors 0／orphans 0／
  reachable 1.0、freshness coverage 1.0／stale 0／mismatch 0／污染面 0%
  （新增的 Contents 錨點全數通過 GitHub slug 對齊後的檢查）。

## 0.6.1 — 2026-09-05

- **修正（links／lib）**：三個一族的壞錨誤報，全部源自 slug 產生與 GitHub 不一致。在 kdan-bpm 實測
  18 筆 `bad_anchors` 於修正後歸零（dead 0／orphans 0／reachable 1.0 不變）。
  - `githubSlug()` 逐個空白換一個 dash（原用 `\s+` 收成單一 dash）。標點被移除後留下的相鄰空白，
    GitHub 會產生雙 dash：`## 狀態圖例 (status / sot_level legend)` → `狀態圖例-status--sot_level-legend`。
  - `extractHeadings()` 只移除**強調用**的底線，詞內底線是字面值（GFM 規則）。原本一律移除，
    `sot_level` 被算成 `sotlevel`，指向該節的連結全成壞錨。
  - `extractHeadings()` 納入顯式錨 `<a id="x">`／`<a name='x'>`（含前置其他屬性）。長期連結常改用顯式錨，
    原本只認 `#` 標題，於是全被誤報。
- **修正（inventory）**：`entry_cost` 對 symlink 別名去重——多個 entry 名指向同一實體檔時
  （如 `CLAUDE.md -> AGENTS.md`）agent 只載入一份，逐名相加會讓固定成本翻倍（實測 5,792 vs 真值 2,896）。
  `files` 仍列出全部名稱，新增 `symlink_aliases` 標出被折疊的別名。
- **文件**：`reference/audit.md`／`reference/rubric.md` 移除「`cjk_uncertain` 壞錨先人工確認再計入」的
  例外——該例外原是為了掩蓋上述 bug，修好後壞錨一律計入，`cjk_uncertain` 降為提示欄位。
- **測試**：54 → 58（slug 雙 dash、詞內底線、顯式錨、symlink 去重各一）。

## 0.6.0 — 2026-09-04

- **新增（腳本）**：第五支量測腳本 `scripts/retrieval.mjs`——可回溯性＋邊際成本，report-only（不計星）。
  對 `.docgrad.yml` 新欄位 `scenarios:`（代表性 code 路徑清單）逐條算 `marginal_tokens`（entry_files＋索引鏈
  ＋錨定 doc 的 tokens，各檔只算一次）、`max_depth`（從 `index_file` BFS 到最遠一份錨定 doc 要幾跳）、
  `fan_in`（錨定它的 doc 數）、`code_pointer`（該路徑的 code 有沒有指回任一 docs）、`churn_commits`
  （近 90 天 commit 數，加權指出「稅最重」的 scenario）；沒有 `scenarios:` 時仍給 `areas`
  （`src_dirs` 各一級子目錄的 `code_pointer`／`fan_in`）與 `index_hotness`（`index_file`／`entry_files`
  近 90 天 commit 數 vs 全部 docs 中位數的 `ratio`＋`top5`）。不吃 `--include`（理由同 `coverage.mjs`，
  可回溯性是全量索引/檢索概念）。新增純函式 `lib.mjs › extractCodeRefs()`：抽 backtick 內以 `src_dirs`
  前綴開頭的路徑、`` `path › symbol` `` 形式、裸檔名（比 basename），供 `retrieval.mjs`／`inventory.mjs`
  共用，不寫死任何目錄名。祖先方向的命中（doc 指到 query 的上層目錄）只認**嚴格深於所屬 `src_dirs`**
  的 ref——泛指整個 app 的提及不算「管這個檔的 doc」，否則同一份 doc 會是每條 scenario 的固定命中。
- **新增（欄位）**：`inventory.mjs` 每檔輸出 `structure: {h2: [{title, tokens_est}], rules: {count,
  median_chars, p90_chars, anchored_ratio}}`（`rules.pattern` 新設定鍵，預設 `**MUST`，判定：清單項
  含該字串即算規則行；`anchored`＝該行本身可用 `extractCodeRefs` 抽到座標）；`totals` 加
  `rules_total`／`rules_anchored_ratio`（全檔彙總，非逐檔平均）。無 H2 的檔 `structure` 仍存在但為空。
- **修正（假象）**：`freshness.mjs` 的 `freshness.convention` 改吃逗號/`+` 分隔的多值（`frontmatter,
  heading-line`），`extractClaimedDate` 依序嘗試、第一個抽到的為準；輸出 `convention` 一律回傳實際採用
  的清單（原本單值也是字串，此為輸出形狀變更，非量測語意變更——`coverage_ratio` 判法本身未動）。新增
  `freshness.heading_field`（heading-line 用的行內關鍵字），只設 `field` 且 convention 含 heading-line
  時 fallback 用 `field`（相容舊設定）。修掉「一次只認一種日期慣例，混用慣例的 repo coverage_ratio
  顯示假性偏低、每輪要人工扣除」的量測假象（動機：kdan-workforce 實測 `docs/superpowers/specs/` 用
  frontmatter、`docs/integrations/`+`docs/runbooks/` 用 heading-line，單值只認得到約 76%）。
- **相容性**：本版**非 rubric 錨點變更**——★1–★5 判定門檻一字未動，歷史分數可比性不受影響
  （Token 經濟＋新增的「可回溯性」小節皆 report-only）。`.docgrad.yml` 新欄位（`scenarios`／`rules`／
  `freshness.heading_field`）全部可選，未設定時四支既有腳本輸出不變；`freshness.convention` 單值行為
  不變。既有 repo 不需重跑 `/docgrad init` 即可繼續用舊設定，想用新訊號才需要補欄位。

## 0.5.0 — 2026-07-26

- **新增**：`reference/placement.md` —— 資訊安置政策。三軸取捨（取用成本／漂移風險／受眾廣度）決定
  每類資訊的權威落點：全塞 entry file 是取用成本最低但 token 稅最貴、最易腐爛的解，故以受眾廣度仲裁。
  六條判定規則含決策資訊的切法——**當前結論的根據寫進它所約束的那份 spec 本身**（根據與結論不分家、
  覆寫而非累積、要含被否決方案與否決條件），辯論過程才留 issue。（issue #4）
- **量測範圍變更（非錨點變更）**：一致性維度的判定範圍從「docs 內部」擴到 **docs ↔ code 註解／spec**
  的落點與重複；失分點分 `[矛盾]`／`[重複]`／`[落點]` 三類。★1–★5 錨點文字未動，但原本 ★5 的 repo
  可能因跨載體重複而下修——跨 0.5.0 比較一致性分數時報告要註明範圍已擴大（同 0.2.0 完整性改以
  coverage 為機械基礎的性質）。決議走擴充維度而非新增第六維：加維度＝rubric 結構變更＝major＋
  所有 repo 歷史分數重新起算。
- **收斂紀律**：`improve`/`loop` 選中一致性時，一輪只修一類失分（`[矛盾]` → `[重複]` → `[落點]`）。
  落點類**只動 docs 範圍內的檔案**——要搬進 code 註解或其他 source 檔的建議一律不自動執行
  （超出「只 commit docs 變更」的 branch 紀律，且腳本驗證不到 code 註解），改列入報告的
  「建議由人處理」清單；因此卡住時判設計性天花板而非 plateau。
- **定位**：`docs/design.md` 補「資訊落點 vs code 品質」的界線——為判落點會讀 code 註解，
  但不評註解品質，否則一致性維度會滑成 code review。

## 0.4.0 — 2026-07-26

- **新增（指令）**：`audit <scope>`／`audit --dim <維度>` —— scoped audit，限定目錄／glob／主題或單一
  維度。一律純報告且**絕不寫入 `.docgrad/`**（scoped 分數混進 history 會毀掉跨輪可比性）；各維度在
  範圍限定下的效力與報告標頭格式見 `reference/audit.md` §scoped audit。（issue #2）
- **新增（CLI）**：四支腳本的共用旗標改由 `scripts/lib.mjs › parseArgs()` 一處解析，新增
  `--include <glob>`（可重複／逗號分隔，支援 `**`／`*`／`?` 與目錄前綴）與 `--config <file>`
  （設定檔外置——文件源本身不能落檔時用）。未知旗標一律丟錯，不再靜默忽略。（issue #2、#3 建議 2）
- **量測語意**：`links.mjs` 在 scope 限定時孤兒回 `[]`、可達率回 `null`（可達性是全量索引概念，
  範圍一縮就失真，不得因此扣星）；`coverage.mjs` 刻意不吃 `--include`（docs 端一縮會把範圍外的提及
  誤判成 undocumented），並在 `note` 說明；`inventory.mjs` 的 `entry_cost.files` 改列實際計入的 entry 檔。
- **相容性**：不加旗標時四支輸出除多一個 `scope: null` 欄位外與 0.3.0 相同；rubric 錨點未動。

## 0.3.0 — 2026-07-26

- **新增（loop 行為）**：`reference/improve.md` 新增**設計性天花板**——某維的下一星錨點落在 Blocker
  禁區時直接判該維「docgrad 範圍內已收斂」、移出挑維度與達標判定，並在畢業建議點名它。修掉
  「新鮮度 ★5 要 CI gate ／ Blocker #3 不碰 CI」的結構性矛盾被誤報成 plateau 的問題（issue #1）。
- **文件（適用邊界）**：README／SKILL.md／`docs/design.md` 明示前提——本地 markdown 檔案樹＋
  可寫入 `.docgrad.yml`；git 非硬需求（無 git 時新鮮度降級為 claimed-only）；wiki／遠端文件源不支援，
  該場景可獨立借用 rubric 五維錨點做人工評分（issue #3 之邊界文件化部分）。
- **註記（非錨點變更）**：rubric 新鮮度 ★5 標註為畢業後範圍（graduation-only）。
  ★1–★5 判定門檻一字未動，歷史分數可比性保留。

## 0.2.0 — 2026-07-13

- **新增**：第四支量測腳本 `scripts/coverage.mjs`（覆蓋漂移）——git 比對每個 code 區域與提及它的
  docs 的時滯，機械偵測 `undocumented`／`drifted` 區域，餵給完整性定星。修掉「新功能長在既有
  模組內部而沒寫文件時，完整性 ★5 虛掛不動」的漏洞。
- **設定**：`.docgrad.yml` 新增 `src_dirs` 與 `coverage:`（`drift_after_days: 30`、`min_commits: 3`）。
  既有 repo 需重跑 `/docgrad init` 或手動補 `src_dirs`；未設定時完整性降級為純 LLM 對照（同舊版行為）。
- **量測方法變更（非錨點變更）**：rubric 完整性「量測」行改以 coverage 輸出為機械基礎；
  星等錨點一字未動，歷史分數可比性保留。
- **發佈**：plugin 化（`.claude-plugin/plugin.json`＋`marketplace.json`），支援
  `/plugin marketplace add redtear1115/docgrad` 安裝與版本更新通知。

## 0.1.0 — 2026-07-12

- 首發：五維 rubric（完整性/正確性/新鮮度/連結度/一致性）＋token 經濟報告；
  `init · audit · improve · loop · report` 五指令；三支零依賴量測腳本（inventory/links/freshness）。
