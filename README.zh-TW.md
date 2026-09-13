# docgrad

[English](README.md) | **繁體中文**

[![release](https://img.shields.io/github/v/release/redtear1115/docgrad?filter=docgrad--*)](https://github.com/redtear1115/docgrad/releases/latest) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Last updated:** 2026-09-13

> 你的文件現在是 agent 在讀，而 agent 載入的每一份檔案都有價錢。docgrad 把一個 repo 的文件當成
> **AI agent 的 context 來源**做六維評分，再逐輪修到你設定的目標為止。

一個 Claude Code skill。六維計星 ★1–★5——完整性、正確性、新鮮度、連結度、一致性，以及**經濟性**，
後者算的是 agent 每一次任務都要付的 token 稅。五支零依賴 Node 腳本產生機械訊號；星等錨點凍結在單一檔案裡，
所以跨輪分數可比。`loop` 一直跑到全維達標、plateau，或撞到只有人能決定的事。

## 為什麼要有第六個「成本」維度

多數文件檢查工具只往一個方向最佳化：覆蓋更多、死鏈更少、文筆更好。套到 agent 的 context 來源上，
這個方向是要付帳的。入口檔（`CLAUDE.md`、`AGENTS.md`）**每一次**任務都會載入，不管這次任務用不用得到；
而外部對照（多個 coding agent 在 SWE-Bench Lite 與 AgentBench 上）指出 context 檔變長會提高成本，
卻未必提高成功率。

所以經濟性是**刻意**與完整性反向的，loop 因此有一道機械煞車：

| 維度 | 評什麼 | 訊號 |
|---|---|---|
| **完整性** | 核心領域到底有沒有文件？ | `coverage.mjs`——未文件化與漂移區域，加 LLM 對照 |
| **正確性** | 文件的宣稱還符合 code 嗎？ | claim ledger——腳本決定抽樣，逐條對原始碼驗證 |
| **新鮮度** | 日期訊號存在嗎、誠實嗎？ | `freshness.mjs`——訊號覆蓋、staleness、git 對照 |
| **連結度** | 單一索引走得到全部嗎？ | `links.mjs`——死鏈、壞錨、孤兒、可達率 |
| **一致性** | 一主題一權威，docs 與 code 註解一起看 | LLM 跨文件比對，並以 code 三角驗證 |
| **經濟性** | agent 每次任務付多少？ | `inventory.mjs`——入口檔 token、污染面 |

有三件事讓這組張力不會變成拉鋸：經濟性排在 tie-break 順序最後、`entry_files` 以外的文件不計入固定成本
（所以把內容**搬出**入口檔可以同時滿足兩維），以及每輪都驗證其他維度沒有下降。

## 裝了它要付多少

一個評 context 成本的工具，該先公布自己的成本。以下取自 `claude plugin details docgrad`：

```
Always-on:   ~227 tok   每個 session 都加
On-invoke:   ~1.8k tok  每次 skill 觸發時付
```

五支量測腳本是純 Node、零依賴，在模型之外執行。

## 從安裝到畢業

### 0. 安裝（一次）

```bash
claude plugin marketplace add redtear1115/docgrad
claude plugin install docgrad@docgrad --scope user
```

重開 Claude Code，然後跑 `/docgrad`——它會印出路由表，不做任何事。
需求：Claude Code 與 Node.js ≥18。完整的安裝／更新／移除路徑見[下方](#安裝更新移除)。

### 1. `/docgrad init` —— 設定目標 repo（一次）

在要評分的 repo 跑。docgrad 掃描候選結構（docs 目錄、always-loaded 入口檔、索引檔、應排除目錄），
用問卷逐項跟你確認，寫出 `.docgrad.yml`——進版控、團隊共用。這是唯一一次手動設定；
之後每個指令都讀它，沒有它就一律擋下來。

### 2. `/docgrad audit` —— 看基線（不改檔）

跑一次全量評分：六維各 ★1–★5、主要失分點，附 token 經濟報告。純報告，不動任何檔案。

```
/docgrad audit docs/infra/      # 也吃「infra 相關文件」這種主題描述
/docgrad audit --dim freshness  # 只評一維
```

scoped 報告一律**不寫入 `.docgrad/`**——歷輪走勢只認全量 audit，混進 scoped 分數就失去可比性。

### 3. `/docgrad improve` / `/docgrad loop` —— 逐輪收斂

```
/docgrad loop     # 反覆修到達標；想一輪一輪來就用 improve
```

每輪挑**最低分維度**、只修那一維（收斂不是重寫），重評確認該維上升、其他維不降，然後 commit。
所有變更落在 `docgrad/converge` branch，每輪一個 commit——中斷可續、可回退、可整批 review 後再合併。

`loop` 跑到三種停止條件之一：

- **達標**——全維 ≥ 你在 `.docgrad.yml` 設的 targets（預設 ★4），或已判設計性天花板。
- **plateau**——連兩輪零進步，報告會指出卡在哪一維、為何 skill 修不動。
- **需人裁決**——遇到 code 無法仲裁的矛盾或產品決策，列出選項暫停等你。

**設計性天花板**＝某維再上一星必須做 docgrad 禁區的事——目前只有新鮮度 ★5 與經濟性 ★5，兩者都要求 CI gate。
這些維度會標成「已在 docgrad 職權內收斂」並移出工作集，而不是被誤報成 plateau，
讓你以為多跑幾輪還有救。

### 4. 畢業 —— 把規則沉澱成 CI

全維達標時，收官報告會**產出畢業交付物**：`.docgrad/graduation/` 下的 `docs-gate.mjs` 與 `docs-gate.yml`，
門檻已按該 repo 現況設好。**產出但不安裝**——要啟用得自己複製到 `.github/`，docgrad 絕不寫入你的 CI 設定。

沒有這道 gate，收斂會自然衰減：曾有一個 repo 在收官當天就冒出新孤兒與缺日期的檔案，兩個月後仍在原地。
死鏈與格式其實有更成熟的現成工具（lychee、markdownlint、Vale）；這幾支腳本的差異化價值在
孤兒／可達性分析與入口檔 token 預算。

## 指令速查

| 指令 | 作用 |
|---|---|
| `/docgrad init` | 掃描＋問卷 → 寫 `.docgrad.yml` 進目標 repo（一次性） |
| `/docgrad audit` | 單次全量評分，產出 scorecard（不改檔） |
| `/docgrad audit <範圍>`／`--dim <維度>` | 限定目錄／主題或單一維度的 scoped 報告（不改檔、不落檔） |
| `/docgrad improve` | 跑一輪收斂：挑最低分維度 → 修 → 重評 → commit |
| `/docgrad loop` | 反覆 improve 直到達標／plateau／需人裁決 |
| `/docgrad report` | 重印最近 scorecard＋歷輪分數走勢 |

路由與 blockers 的權威定義在 [SKILL.md](SKILL.md)，本表僅摘要。

## 安裝、更新、移除

以下指令都是 **user scope**——裝一次，每個 repo 都能用。

```bash
# 安裝
claude plugin marketplace add redtear1115/docgrad
claude plugin install docgrad@docgrad --scope user

# 更新
claude plugin marketplace update docgrad
claude plugin update docgrad

# 移除
claude plugin uninstall docgrad@docgrad --scope user
```

session 內的 `/plugin install` 對話框會問 scope，選 **User**。之後 `/plugin` 的 Marketplaces 頁
會顯示可更新版本（也可對此 marketplace 開啟自動更新）。版本與變更內容見 [CHANGELOG.md](CHANGELOG.md)。

### 讓 agent 自己裝

把下面這段貼給任何一個 Claude Code session：

> 幫我安裝 docgrad plugin：先跑 `claude plugin marketplace add redtear1115/docgrad`，
> 再跑 `claude plugin install docgrad@docgrad --scope user`，要重啟就重啟。
> 然後執行 `/docgrad` 並把路由表印給我看，讓我確認有載入。

之後要更新：

> 幫我更新 docgrad plugin：`claude plugin marketplace update docgrad`，然後 `claude plugin update docgrad`。
> 告訴我更新到哪一版，並把該 repo 的 CHANGELOG.md 裡舊版到新版之間的變更摘要給我。

想一口氣從零跑到第一份分數：

> 幫我安裝 docgrad（marketplace `redtear1115/docgrad`、plugin `docgrad@docgrad`、user scope），
> 然後在這個 repo 跑 `/docgrad init`，問卷能從 repo 推斷的你自己填，只有入口檔與排除清單來問我，
> 接著跑 `/docgrad audit` 把 scorecard 給我看。

### 不用 plugin 系統

```bash
git clone https://github.com/redtear1115/docgrad ~/.claude/skills/docgrad
```

更新＝到該目錄 `git pull`；是否有新版自己對 [CHANGELOG.md](CHANGELOG.md)。
你只損失更新通知，其他都一樣。

## Case studies

實際跑出來的量測，附可重跑的指令。對工具有利與不利的數字都在裡面。

| | 受測對象 | 量什麼 | 結論 |
|---|---|---|---|
| [1](case-studies/01-commander-js.md) | `tj/commander.js` | 收斂前後，同一個功能設計任務的**真實 agent token 用量** | 設計品質兩臂都是 12/12 打平；收斂後**輪數少 15%**，但進 context 的 **token 多 20%** |
| [2](case-studies/02-docgrad-self.md) | docgrad 自己，9 輪真實收斂 | 產品長大時，文件的 token 成本落在哪裡 | 語料成長 3.4×，但每次任務付的稅只成長 1.8×，**佔語料比例反而腰斬** |
| [3](case-studies/03-fixtures.md) | 三個 eval fixture | 這把尺到底可不可重現 | 12 次全數通過，18 個維度格中 16 格完全一致——並抓出 rubric 的一個真缺口 |

打算查核數字的話，先讀[方法說明](case-studies/README.md)。

## 適用邊界

docgrad 評的是**本地 markdown 檔案樹**：五支腳本都以本地路徑運作，`.docgrad.yml` 也要能寫進目標 repo 根目錄。

- **git 不是硬需求**：沒有 git 時新鮮度只認文件自稱的日期、覆蓋漂移無法量測，其餘照跑。
- **wiki／Confluence 等遠端文件源不支援**：檔案不在樹上、設定檔無處可放。真要評這類文件源，
  可只借用 [reference/rubric.md](reference/rubric.md) 的六維錨點做人工評分——無機械訊號、不可重現，也不落 scorecard。
- **新鮮度 ★5 屬畢業後範圍**：★5 要求 CI gate，而 docgrad 不碰 CI，所以 loop 內該維上限 ★4。
  預設 target 就是 ★4，只有把 target 調到 5 才會遇到。

不評 prose 風格（Vale 的事）、不評 SKILL.md 本身、不評程式碼品質。一致性維度**會讀** code 註解，
但只判「同一件事有沒有第二份權威、位置對不對」（見 [reference/placement.md](reference/placement.md)），
不評註解寫得好不好。完整定位見 [docs/design.md](docs/design.md)。

## Repo 結構

```text
docgrad/
├── SKILL.md            # 路由、blockers、scripts 契約
├── reference/          # rubric（凍結錨點）、audit、improve、init、placement
├── scripts/            # 五支零依賴 Node 量測腳本
├── templates/          # 畢業交付物：docs-gate.mjs / docs-gate.yml
├── case-studies/       # 實測紀錄，附重跑指令
├── evals/              # skill 級評測（星等可不可重現？）
├── tests/              # 腳本單元測試
└── docs/               # design.md、how-to.md
```

## 開發

```bash
node --test tests/*.test.mjs
```

skill 級評測（星等可重現性、抽樣覆蓋率、偽陽性）另見 [evals/README.md](evals/README.md)——
`tests/` 測的是腳本輸出，測不到星等穩不穩。

設計文件：[docs/design.md](docs/design.md)；常見開發任務：[docs/how-to.md](docs/how-to.md)；
出處致謝：[NOTICE.md](NOTICE.md)。

## 授權

MIT
