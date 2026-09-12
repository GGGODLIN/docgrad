# docgrad evals

> **Last updated:** 2026-09-13

skill 級評測：量的是「agent 拿這個 skill 去評分，結果穩不穩、對不對」，
不是腳本的單元行為（那是 `tests/`，`node --test tests/*.test.mjs`）。

## Contents

- [為什麼需要](#為什麼需要)
- [三個 case](#三個-case)
- [怎麼跑](#怎麼跑)
- [目前狀態：已撰寫、尚未執行](#目前狀態已撰寫尚未執行)
- [fixtures 的機械基準值](#fixtures-的機械基準值)

## 為什麼需要

`tests/` 有 60+ 個單元測試全過，但它們測的是五支腳本的輸出，**不是星等的穩定性**。
2026-07-13 oikos 收官後同日重驗，一致性 ★4→★2——單元測試一個都沒紅，因為壞的不是腳本。

沒有 eval 就回答不了「★4 的誤差是 ±0 還是 ±2」，也驗不出 v1.1.0 的抽樣機械化是否真的有效。
這也是 Anthropic skill authoring checklist 的 Testing 三項（≥3 個 evaluation、跨模型測、
真實場景測）要求的東西。

## 三個 case

| case | 測什麼 | 通過條件 |
|---|---|---|
| `linkage-known` | **可重現性** | 死鏈 1/12 ＝ 8.33% 只能是連結度 ★2；多次執行星等必須完全一致 |
| `planted-contradiction` | **抽樣覆蓋率** | 矛盾句在錨點行的**鄰句**（無 code ref）——只驗錨點行就會漏掉 |
| `clean-baseline` | **偽陽性** | 全乾淨的 repo 不得被扣分；提高敏感度不能變成到處誤報 |

前兩個逼 docgrad 抓錯，第三個確認它不會為了抓錯而誤傷。三者缺一，另外兩個的結論都不可信。

## 怎麼跑

```bash
claude plugin eval . --runs 5
```

- `--runs 5`：**星等分布本身就是指標**。三次跑出 ★2／★2／★3 代表該處還留著自由度，
  要當缺陷追，不是取眾數了事。
- `--model`：checklist 要求 Haiku／Sonnet／Opus 都測。rubric 是大量 zh-TW 判斷性散文，
  弱模型能否穩定對號入座**完全未知**——這正是要量的。
- `--threshold`：全綠才算過；`linkage-known` 的星等沒有解釋空間。

## 目前狀態：已撰寫、尚未執行

`claude plugin eval` 在本機回報 **early access**，無法執行：

```
$ claude plugin eval init --bare probe
`plugin eval` is currently in early access
```

所以 **case 已按 CLI `--help` 明載的 `prompt.md` + `graders/*.md` 佈局寫好，但一次都還沒跑過，
本檔不列任何分數**。取得權限後要做的第一件事是跑一輪 `--runs 5`，把星等分布記錄下來當基線。

`case.yaml` 的欄位 schema 未公開，本 suite **刻意不寫** `case.yaml`——寧可少用進階功能，
也不猜格式。`--runs`／`--model` 等一律走 CLI 旗標。

## fixtures 的機械基準值

`evals/fixtures/` 下三個 repo 的腳本輸出是固定的，grader 的斷言直接建立在這些數字上。
改動 fixture 前先重跑對照，數字變了就要同步改 grader：

```bash
for f in clean linkage-known planted-contradiction; do
  node scripts/links.mjs     --root evals/fixtures/$f
  node scripts/freshness.mjs --root evals/fixtures/$f
done
```

| fixture | links | dead | orphans | reachable | freshness coverage |
|---|---|---|---|---|---|
| `clean` | 3 | 0 | 0 | 1.0 | 1.0 |
| `linkage-known` | 12 | 1 | 0 | 1.0 | 1.0 |
| `planted-contradiction` | 2 | 0 | 0 | 1.0 | 1.0 |
