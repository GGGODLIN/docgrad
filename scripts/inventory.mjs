#!/usr/bin/env node
// inventory.mjs — 文件清單＋CJK-aware token 量測＋固定成本/污染面＋段落級結構指標
// 用法: node inventory.mjs [--root <repo>] [--config <file>] [--include <glob>]；JSON → stdout。
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, collectFiles, estimateTokens, parseArgs, fail, extractCodeRefs } from './lib.mjs';

const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+\.)\s+/;

function fileType(p, config) {
  if (config.entry_files.includes(p)) return 'entry';
  if (p === config.index_file) return 'index';
  return 'doc';
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function percentile90(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(0.9 * s.length) - 1));
  return s[idx];
}

// H2 段落切片（非 fence 內的 "## " 開新段）；tokens_est 含該段整段內容（不含標題行本身）。
function extractH2Sections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = null;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      if (current) current.lines.push(line);
      continue;
    }
    if (!inFence) {
      const m = line.match(/^##\s+(.+?)\s*#*\s*$/);
      if (m) {
        if (current) sections.push(current);
        current = { title: m[1].replace(/[*_`]/g, '').trim(), lines: [] };
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ title: s.title, tokens_est: estimateTokens(s.lines.join('\n')) }));
}

// 規則行＝清單項（允許前置 emoji，判定只看是否含 pattern 子字串）且含 rules.pattern。
// anchored＝該行本身用 extractCodeRefs 抽得到座標。
function extractRuleLines(text, pattern, srcDirs) {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  const rules = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!LIST_ITEM_RE.test(line)) continue;
    if (!line.includes(pattern)) continue;
    const content = line.replace(LIST_ITEM_RE, '').trim();
    rules.push({ chars: content.length, anchored: extractCodeRefs(line, srcDirs).length > 0 });
  }
  return rules;
}

function buildStructure(text, config) {
  const ruleLines = extractRuleLines(text, config.rules.pattern, config.src_dirs);
  return {
    h2: extractH2Sections(text),
    rules: {
      count: ruleLines.length,
      median_chars: median(ruleLines.map((r) => r.chars)),
      p90_chars: percentile90(ruleLines.map((r) => r.chars)),
      anchored_ratio: ruleLines.length
        ? Number((ruleLines.filter((r) => r.anchored).length / ruleLines.length).toFixed(4))
        : 0,
    },
    // 供 totals 彙總用，不落 JSON（避免與 rules.count/anchored_ratio 重複展開語意）。
    _ruleLines: ruleLines,
  };
}

function measure(rootDir, relPath, config) {
  const text = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
  const structure = buildStructure(text, config);
  const ruleLines = structure._ruleLines;
  delete structure._ruleLines;
  return {
    path: relPath,
    bytes: Buffer.byteLength(text),
    tokens_est: estimateTokens(text),
    type: fileType(relPath, config),
    structure,
    _ruleLines: ruleLines, // 內部彙總用，輸出前會被移除
  };
}

try {
  const { root, configFile, include } = parseArgs();
  const config = loadConfig(root, configFile);
  const { included, excluded } = collectFiles(root, config, { include });
  const filesRaw = included.map((p) => measure(root, p, config));
  const excludedFiles = excluded.map((p) => measure(root, p, config));
  const rulesTotal = filesRaw.reduce((s, f) => s + f._ruleLines.length, 0);
  const rulesAnchored = filesRaw.reduce((s, f) => s + f._ruleLines.filter((r) => r.anchored).length, 0);
  const files = filesRaw.map(({ _ruleLines, ...f }) => f);
  const totalTokens = files.reduce((s, f) => s + f.tokens_est, 0);
  const excludedTokens = excludedFiles.reduce((s, f) => s + f.tokens_est, 0);
  process.stdout.write(
    `${JSON.stringify(
      {
        scope: include.length ? include : null,
        files,
        totals: {
          files: files.length,
          bytes: files.reduce((s, f) => s + f.bytes, 0),
          tokens_est: totalTokens,
          rules_total: rulesTotal,
          rules_anchored_ratio: rulesTotal ? Number((rulesAnchored / rulesTotal).toFixed(4)) : 0,
        },
        entry_cost: (() => {
          // scope 限定時只計範圍內的 entry 檔——固定成本是全量概念，scoped 報告不可直接引用。
          // symlink 去重：多個 entry 名指向同一實體檔（kdan-bpm 的 `CLAUDE.md -> AGENTS.md`）時，
          // agent 只會載入一份，逐名相加會讓固定成本翻倍（2026-09-05 量到 5,792 vs 真值 2,896）。
          // 以 realpath 分組，同一實體只計一次；files 仍列出全部名稱，並標出被折疊的別名。
          const entries = files.filter((f) => f.type === 'entry');
          const seen = new Map();
          const aliases = [];
          for (const f of entries) {
            let key = f.path;
            try {
              key = fs.realpathSync(path.join(root, f.path));
            } catch {
              /* 讀不到就退回路徑本身，寧可重複計也不要漏計 */
            }
            if (seen.has(key)) {
              aliases.push({ path: f.path, same_file_as: seen.get(key) });
              continue;
            }
            seen.set(key, f.path);
          }
          const counted = new Set(seen.values());
          return {
            files: entries.map((f) => f.path),
            tokens_est: entries
              .filter((f) => counted.has(f.path))
              .reduce((s, f) => s + f.tokens_est, 0),
            ...(aliases.length ? { symlink_aliases: aliases } : {}),
          };
        })(),
        pollution: {
          excluded_files: excludedFiles.map((f) => ({ path: f.path, tokens_est: f.tokens_est })),
          excluded_tokens: excludedTokens,
          ratio:
            totalTokens + excludedTokens === 0
              ? 0
              : Number((excludedTokens / (totalTokens + excludedTokens)).toFixed(4)),
        },
      },
      null,
      2
    )}\n`
  );
} catch (err) {
  fail(err.message);
}
