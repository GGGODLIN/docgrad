# init — 一次性設定

> **Last updated:** 2026-09-13

目的：掃描目標 repo → 問卷確認 → 把 `.docgrad.yml` 寫進目標 repo 根目錄（進版控，團隊共用）。
已有 `.docgrad.yml` 時重跑 init＝重新掃描，並以現有設定為問卷預設值。

## 1. 掃描（全部做完再一次問，不要邊掃邊問）

| 項目 | 偵測方式 | 候選 |
|---|---|---|
| docs 目錄 | Glob 頂層目錄 | `docs/`、`doc/`、`documentation/`；其他含 ≥3 個 .md 的頂層目錄 |
| 入口檔（always-loaded） | Glob root 與 .github/ | `CLAUDE.md`、`AGENTS.md`、`GEMINI.md`、`.cursorrules`、`.github/copilot-instructions.md` |
| 單檔文件（條件式載入） | Glob root 的 .md，扣掉入口檔／索引檔候選 | `PRODUCT.md`、`DESIGN.md`、`ARCHITECTURE.md`、`CONTRIBUTING.md` |
| 索引檔 | docs 目錄內 | `README.md`、`index.md`、`TOC.md` |
| 排除目錄 | 名稱樣式＋.gitignore | `archive/`、`deprecated/`、`generated` 標記、gitignored 的 WIP 目錄 |
| src 目錄 | Glob 頂層目錄 | `src/`、`lib/`、`app/`、`packages/`；其他含程式碼的頂層目錄 |
| 新鮮度慣例 | 抽 5 份 docs 檔看頭部 | frontmatter 日期欄位／「Last updated:」類行／無 |

## 2. 問卷（AskUserQuestion，逐項帶掃描結果當預設選項）

1. `docs_dirs`（多選，帶掃描候選）
2. `entry_files`（多選）——判準是「**agent 每次任務都會自動載入**」，不是「重要」。
   給人看的 GitHub 落地頁（典型是 root `README.md`）除非同時是 agent 入口，否則**不要列**：
   自 v1.0.0 起固定成本計星（經濟性），多列一份就是憑空多付的稅，少列必讀檔則會低報。
   它同時是索引時，填進 `index_file` 就好，兩處不必重複。
3. `docs_files`（多選）——`docs_dirs` **之外的單一 markdown 檔**，以**一般文件**納入語料
   （`type: 'doc'`，不計入固定成本）。典型是 repo 根的 `PRODUCT.md`／`DESIGN.md`。
   - **與 `entry_files` 的差別是「載入時機」，不是「重要性」**：每次任務都自動載入 → `entry_files`；
     只有做某類工作時才讀（入口檔寫著「動 UI 前先讀 `DESIGN.md`」）→ `docs_files`。
     一份文件同時列兩處沒有意義——`entry_files` 會勝出並計入固定成本。
   - **選錯的代價是不對稱的**。把條件式文件塞進 `entry_files` 會憑空灌水固定成本
     （oikos 實測 9,037 → 21,474 tokens，跨過 `economy.entry_cost_tiers` 的 20,000 而讓經濟性
     ★3→★1），且 [audit.md](audit.md) §經濟性 會查出 `entry_cost.files` 與現實不符、**另記**
     一個失分點。反方向（把真正 always-loaded 的檔放進 `docs_files`）則是低報固定成本，同樣失真。
   - **只吃檔案**：列目錄會丟錯（目錄請放 `docs_dirs`）；檔案不存在則靜默略過；
     `docs_dirs` 已掃到的檔不必重複列（重複也只算一次）。
   - **不是可達性起點**：它比照一般文件做孤兒判定，得有文件連到它，否則連結度會記一筆孤兒。
     這是刻意的——條件式文件如果連不到，agent 就只能靠猜找到它。
4. `index_file`（單選；無候選 → 填 `null` 並提醒：連結度會因無可達性根而受限，improve 第一輪可代建索引）
5. `exclude`（多選；掃到的候選＋自由輸入）
6. freshness `convention`（frontmatter / heading-line / none；可多選——同一 repo 混用兩種慣例時選多個，
   逗號分隔寫入）＋ `field`（frontmatter 用）／`heading_field`（heading-line 用；只選一種慣例且該慣例
   已用 `field` 描述時可留空，腳本會 fallback 用 `field`）
7. `targets`：預設全 4（六維），問「哪些維度願意降到 3？」（多選）。
   經濟性若因該 repo 的入口檔本來就很大而難以達標，寧可降 target 也不要改
   `economy.entry_cost_tiers`——改門檻等於改 rubric 錨點，會讓歷史分數失去可比性
8. `scenario`：請使用者用一句話描述該 repo 的代表性開發任務（無 `scenarios` 時的 LLM 模擬 fallback 用）
9. `correctness_sample`：預設 8；大型 docs 體系（>50 檔）建議 12
10. `src_dirs`（多選，帶掃描候選；覆蓋漂移偵測與 retrieval.mjs 用）：選空 → 完整性降級為純 LLM 對照
    （coverage.mjs 不量測、只輸出 note），retrieval.mjs 的 `areas`／`code_pointer_ratio` 同樣降級
11. `scenarios`：請使用者給 2–4 個代表性 code 路徑（檔案或目錄，例如
    `apps/api/src/contract/contract-approval.service.ts`、`apps/api/src/timesheet`）——retrieval.mjs
    用它機械算邊際成本與可回溯性（見 [rubric.md](rubric.md) §Token 經濟／可回溯性）；選空則該部分
    退回 LLM 依 `scenario` 模擬，仍會給 areas／index_hotness
12. `rules.pattern`：規則行判定字串，預設 `**MUST`（沿用該 repo 既有的規則標記慣例即可，通常不必改）

## 3. 寫檔

寫入 `.docgrad.yml`（值全部帶入問卷結果；只用兩層結構與 inline list，確保腳本可解析）：

```yaml
# .docgrad.yml — docgrad 設定（進版控，團隊共用）
docs_dirs: [docs/]
docs_files: [PRODUCT.md, DESIGN.md]   # docs_dirs 之外的單檔，當一般文件收（不計固定成本）；可省略
entry_files: [CLAUDE.md]
index_file: docs/README.md
exclude: [docs/archive/]
src_dirs: [src/]
freshness:
  convention: frontmatter   # 單值；混用兩種慣例時：frontmatter,heading-line
  field: last_updated
  # heading_field: "Last updated:"   # heading-line 用的行內關鍵字；只選一種且已設 field 時可省略
coverage:
  drift_after_days: 30   # doc 落後 code 幾天才算漂移（預設 30）
  min_commits: 3         # 期間 code commit 數達幾次才算漂移（預設 3）
targets:
  completeness: 4
  correctness: 4
  freshness: 4
  linkage: 4
  consistency: 4
  economy: 4
economy:
  entry_cost_tiers: [20000, 10000, 5000, 3000]   # 經濟性 ★1/★2/★3/★4→★5 的固定成本門檻
  pollution_max: 0.1                              # 污染面上限；超過時經濟性上限 ★3
correctness_sample: 8
scenario: "在 <某模組> 加一個典型新功能"   # 無 scenarios 時的 LLM 模擬 fallback
scenarios: [src/foo/bar.ts, src/foo]      # retrieval.mjs 機械模擬邊際成本＋可回溯性用；可省略
rules:
  pattern: "**MUST"   # 規則行判定字串（inventory.mjs structure.rules 用），預設值即此
language: zh-TW
```

寫完立刻驗證：`node "$SKILL_DIR/scripts/inventory.mjs" --root .` 能跑出 JSON 才算完成。

## 文件源不可寫時（設定檔外置）

文件樹本身不能落檔（唯讀掛載、匯出目錄）→ 把 `.docgrad.yml` 寫到別處，腳本以 `--config <file>`
指定即可跑 `audit`（`improve`/`loop` 仍需要可寫且有 git 的工作區）。這只解決設定檔的落點，
不改變「文件必須是本地 markdown 檔案樹」的前提——邊界見 [design.md](../docs/design.md) §定位與邊界。

## 4. 收尾

- 印出寫入內容摘要（各欄位一行）。
- 建議使用者把 `.docgrad.yml` commit 進版控；經同意後代為 commit
  （message：`chore: docgrad init — 文件評估設定`）。
- 提示下一步：`/docgrad audit` 看第一份 scorecard。
