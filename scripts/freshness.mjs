#!/usr/bin/env node
// freshness.mjs — 日期訊號覆蓋率＋git log 真實日期對照
// 用法: node freshness.mjs [--root <repo>] [--config <file>] [--include <glob>]；JSON → stdout。
// env DOCGRAD_TODAY=YYYY-MM-DD 可覆寫「今天」（測試可重現）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, collectFiles, parseArgs, fail, extractClaimedDate, parseFreshnessConventions } from './lib.mjs';

const MISMATCH_TOLERANCE_DAYS = 7;

// docgrad 自己的收斂 commit 不算「內容有更新」——improve/loop 的 commit message 一律是
// `docs(docgrad): 第 N 輪收斂 …`（見 reference/improve.md 步驟 5）。
// 不排除的話會自我污染：round 1 backfill 39 檔的 last_updated，那個 commit 本身把這些檔的
// git 日期整批推到當天，於是 round 2 收到 38 筆假 mismatch（oikos 2026-07-13 實際發生）。
const DOCGRAD_COMMIT_PREFIX = 'docs(docgrad):';

function gitDate(root, rel) {
  try {
    // 取最近一筆**非 docgrad** commit 的日期：一次多撈幾筆再過濾，避免逐筆呼叫 git。
    const out = execFileSync('git', ['log', '-20', '--format=%as%x00%s', '--', rel], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return null;
    const entries = out.split('\n').map((l) => {
      const [date, subject = ''] = l.split('\0');
      return { date, subject };
    });
    const authored = entries.find((e) => !e.subject.startsWith(DOCGRAD_COMMIT_PREFIX));
    // 全部 20 筆都是 docgrad commit（極少見）→ 退回最舊那筆，寧可偏保守也不要回 null。
    return (authored ?? entries.at(-1)).date || null;
  } catch {
    return null;
  }
}

// 日期訊號的鑑別力：同一天佔比過高＝大批 backfill 的痕跡，這些檔會同步老化、同步變 stale，
// coverage_ratio 再高也分辨不出「哪份文件真的久未維護」。只報告，不影響 coverage_ratio 判法。
function dateConcentration(claimedDates) {
  if (!claimedDates.length) return { max_same_day_ratio: 0, date: null, files: 0 };
  const counts = new Map();
  for (const d of claimedDates) counts.set(d, (counts.get(d) ?? 0) + 1);
  let top = null;
  for (const [date, n] of counts) if (!top || n > top[1] || (n === top[1] && date < top[0])) top = [date, n];
  return {
    max_same_day_ratio: Number((top[1] / claimedDates.length).toFixed(4)),
    date: top[0],
    files: top[1],
  };
}

const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

try {
  const { root, configFile, include } = parseArgs();
  const config = loadConfig(root, configFile);
  const { included } = collectFiles(root, config, { include });
  const today = process.env.DOCGRAD_TODAY ?? new Date().toISOString().slice(0, 10);

  const results = included.map((rel) => {
    const claimed = extractClaimedDate(fs.readFileSync(path.join(root, rel), 'utf8'), config.freshness);
    const actual_git = gitDate(root, rel);
    const basis = actual_git ?? claimed;
    return { path: rel, claimed, actual_git, age_days: basis ? dayDiff(today, basis) : null };
  });

  const withSignal = results.filter((r) => r.claimed !== null);
  process.stdout.write(
    `${JSON.stringify(
      {
        scope: include.length ? include : null,
        // 實際採用的慣例清單（單值也回陣列；多值時依序嘗試，見 lib.mjs › extractClaimedDate）。
        convention: parseFreshnessConventions(config.freshness.convention),
        files_total: results.length,
        files_with_signal: withSignal.length,
        coverage_ratio: results.length ? Number((withSignal.length / results.length).toFixed(4)) : 0,
        date_concentration: dateConcentration(withSignal.map((r) => r.claimed)),
        stale: results.filter((r) => r.age_days !== null && r.age_days > config.freshness.stale_after_days),
        mismatches: results
          .filter((r) => r.claimed && r.actual_git && dayDiff(r.actual_git, r.claimed) > MISMATCH_TOLERANCE_DAYS)
          .map((r) => ({
            path: r.path,
            claimed: r.claimed,
            actual_git: r.actual_git,
            drift_days: dayDiff(r.actual_git, r.claimed),
          })),
      },
      null,
      2
    )}\n`
  );
} catch (err) {
  fail(err.message);
}
