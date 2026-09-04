#!/usr/bin/env node
// retrieval.mjs — 可回溯性＋邊際成本（新量測腳本，report-only，見 reference/rubric.md §Token 經濟）
// 用法: node retrieval.mjs [--root <repo>] [--config <file>] [--include <glob 不生效見 note>]；JSON → stdout。
//
// 量的兩件事：
//   1. scenarios（.docgrad.yml 新欄位：代表性 code 路徑清單）——每條算「從 code 回到管它的 spec」
//      要幾跳（depth_from_index）、邊際 token 成本（marginal_tokens）、有沒有反向指針（code_pointer）。
//   2. areas／index_hotness——不靠 scenarios 也能給的通用訊號：各 src_dirs 子目錄有沒有 code→doc
//      指針（code_pointer_ratio）、索引/入口檔是不是比它索引的東西還常改（index_hotness）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, collectFiles, parseArgs, fail, estimateTokens, extractLinks, extractCodeRefs } from './lib.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git']);
const CHURN_WINDOW_DAYS = 90;

function isGitRepo(root) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

// 近 N 天 commit 數；失敗（非 git／路徑不存在於歷史）→ null。
function commitsSince(root, rel, days) {
  try {
    const sinceIso = new Date(Date.now() - days * 86400000).toISOString();
    const out = execFileSync(
      'git',
      ['rev-list', '--count', 'HEAD', `--since=${sinceIso}`, '--', rel],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return out === '' ? null : Number(out);
  } catch {
    return null;
  }
}

function walkFiles(absDir, out) {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, out);
    else out.push(abs);
  }
}

function readTextSafe(absPath) {
  try {
    const buf = fs.readFileSync(absPath);
    if (buf.includes(0)) return null; // 二進位跳過（粗略判斷：含 NUL byte）
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

// path 底下的實際檔案清單（檔案本身，或目錄遞迴、跳過 node_modules/.git）；不存在 → []。
function resolveFiles(root, relPath) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [relPath];
  const out = [];
  walkFiles(abs, out);
  return out.map((a) => path.relative(root, a).split(path.sep).join('/'));
}

// 雙向目錄前綴比對：a 是 b 的祖先目錄、b 是 a 的祖先目錄，或完全相等。
// 沿用 coverage.mjs 的「contractx 不誤中 contract」原則——沒有 '/' 邊界不算命中。
function pathOverlaps(a, b) {
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

// path 底下任一檔案的內容有沒有指向 docsDirs 或某份 doc 的 basename（code→doc 反向指針）。
function hasCodePointer(root, files, docsDirs, docBasenames) {
  const dirPrefixes = docsDirs.map((d) => d.replace(/\/+$/, ''));
  for (const rel of files) {
    const text = readTextSafe(path.join(root, rel));
    if (!text) continue;
    if (dirPrefixes.some((d) => d && text.includes(d))) return true;
    if (docBasenames.some((b) => text.includes(b))) return true;
  }
  return false;
}

try {
  const { root, configFile, include } = parseArgs();
  const config = loadConfig(root, configFile);
  const { included } = collectFiles(root, config);
  const gitOk = isGitRepo(root);
  const notes = [];
  if (include.length) {
    notes.push(
      '--include 對本腳本不生效：可回溯性與邊際成本是全量索引/檢索概念，範圍一縮會漏掉指路鏈與跨檔錨點（同 coverage.mjs 的理由）'
    );
  }

  const docTexts = included.map((rel) => ({ rel, text: fs.readFileSync(path.join(root, rel), 'utf8') }));
  const tokensOf = new Map(docTexts.map((d) => [d.rel, estimateTokens(d.text)]));
  const docBasenames = included.map((rel) => path.posix.basename(rel));
  // 每份 doc 的 code refs 只抽一次，scenarios/areas 兩段都重用。
  const docRefs = docTexts.map((d) => ({ rel: d.rel, refs: extractCodeRefs(d.text, config.src_dirs) }));

  // --- markdown 連結圖 ＋ 從 index_file 的 BFS 深度（沿用 links.mjs 的連結解析邏輯）--------
  const includedSet = new Set(included);
  const graph = new Map(included.map((p) => [p, new Set()]));
  for (const { rel, text } of docTexts) {
    for (const { target } of extractLinks(text)) {
      if (/^(https?:|mailto:|tel:|data:)/i.test(target)) continue;
      const hashIndex = target.indexOf('#');
      const rawPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
      if (rawPath === '') continue;
      const resolved = rawPath.startsWith('/')
        ? path.posix.normalize(rawPath.slice(1))
        : path.posix.normalize(path.posix.join(path.posix.dirname(rel), rawPath));
      if (includedSet.has(resolved)) graph.get(rel).add(resolved);
    }
  }
  const depthFromIndex = new Map();
  const bfsParent = new Map();
  if (config.index_file && includedSet.has(config.index_file)) {
    depthFromIndex.set(config.index_file, 0);
    const queue = [config.index_file];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of graph.get(cur) ?? []) {
        if (!depthFromIndex.has(next)) {
          depthFromIndex.set(next, depthFromIndex.get(cur) + 1);
          bfsParent.set(next, cur);
          queue.push(next);
        }
      }
    }
  } else {
    notes.push('index_file 未設定或不在 included 範圍內：depth_from_index／marginal_tokens 的索引鏈一律視為不可達');
  }
  // doc 回 index 的最短路徑（含 doc 自己）；不可達（未連上索引鏈）就只算它自己。
  function chainToIndex(doc) {
    if (!depthFromIndex.has(doc)) return [doc];
    const chain = [];
    let cur = doc;
    while (cur !== undefined) {
      chain.push(cur);
      if (cur === config.index_file) break;
      cur = bfsParent.get(cur);
    }
    return chain;
  }

  const entryTokens = config.entry_files.reduce((sum, f) => {
    const abs = path.join(root, f);
    if (!fs.existsSync(abs)) return sum;
    return sum + estimateTokens(fs.readFileSync(abs, 'utf8'));
  }, 0);

  // --- scenarios ---------------------------------------------------------------------
  const scenarioPaths = config.scenarios ?? [];
  const scenarios = scenarioPaths.map((scenarioPath) => {
    const files = resolveFiles(root, scenarioPath);
    const churn_commits = gitOk ? commitsSince(root, scenarioPath, CHURN_WINDOW_DAYS) : null;

    const docs = [];
    for (const { rel, refs } of docRefs) {
      let hits = 0;
      for (const ref of refs) {
        if (ref.basenameOnly) {
          if (files.some((f) => path.posix.basename(f) === ref.path)) hits += 1;
        } else if (pathOverlaps(ref.path, scenarioPath)) {
          hits += 1;
        }
      }
      if (hits > 0) {
        docs.push({
          doc: rel,
          hits,
          tokens_est: tokensOf.get(rel),
          depth_from_index: depthFromIndex.has(rel) ? depthFromIndex.get(rel) : null,
        });
      }
    }
    docs.sort((a, b) => b.hits - a.hits || a.doc.localeCompare(b.doc));

    const marginalSet = new Set();
    for (const d of docs) {
      for (const node of chainToIndex(d.doc)) marginalSet.add(node);
    }
    const marginal_tokens =
      entryTokens + [...marginalSet].reduce((s, rel) => s + (tokensOf.get(rel) ?? 0), 0);
    const depths = docs.map((d) => d.depth_from_index).filter((d) => d !== null);

    return {
      path: scenarioPath,
      churn_commits,
      docs,
      fan_in: docs.length,
      marginal_tokens,
      max_depth: depths.length ? Math.max(...depths) : null,
      code_pointer: hasCodePointer(root, files, config.docs_dirs, docBasenames),
    };
  });
  if (scenarioPaths.length === 0) {
    notes.push('scenarios 未設定（.docgrad.yml）：邊際成本無法機械模擬（退回 LLM 依 scenario 模擬），仍給 areas 與 index_hotness');
  }

  // --- areas（src_dirs 第一層子目錄；定義同 coverage.mjs）--------------------------------
  let areas = [];
  if (config.src_dirs.length === 0) {
    notes.push('src_dirs 未設定，無法量測 areas／code_pointer_ratio');
  } else {
    const areaList = [];
    for (const srcDir of config.src_dirs) {
      const absSrc = path.join(root, srcDir);
      const base = srcDir.replace(/\/+$/, '');
      if (!fs.existsSync(absSrc)) continue;
      for (const entry of fs.readdirSync(absSrc, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        if (entry.isDirectory()) areaList.push(`${base}/${entry.name}`);
      }
    }
    areaList.sort();
    areas = areaList.map((area) => {
      const files = resolveFiles(root, area);
      let fan_in = 0;
      for (const { refs } of docRefs) {
        if (refs.some((ref) => !ref.basenameOnly && pathOverlaps(ref.path, area))) fan_in += 1;
      }
      return { area, code_pointer: hasCodePointer(root, files, config.docs_dirs, docBasenames), fan_in };
    });
  }
  const code_pointer_ratio = areas.length
    ? Number((areas.filter((a) => a.code_pointer).length / areas.length).toFixed(4))
    : null;

  // --- index_hotness -------------------------------------------------------------------
  let index_hotness = null;
  if (gitOk) {
    const perDoc = included.map((rel) => ({ path: rel, commits_90d: commitsSince(root, rel, CHURN_WINDOW_DAYS) ?? 0 }));
    const counts = perDoc.map((d) => d.commits_90d).sort((a, b) => a - b);
    const n = counts.length;
    const median_commits_90d = n === 0 ? 0 : n % 2 ? counts[(n - 1) / 2] : (counts[n / 2 - 1] + counts[n / 2]) / 2;
    const indexCommits = config.index_file ? (commitsSince(root, config.index_file, CHURN_WINDOW_DAYS) ?? 0) : null;
    const entryEntries = config.entry_files.map((f) => ({ path: f, commits_90d: commitsSince(root, f, CHURN_WINDOW_DAYS) ?? 0 }));
    index_hotness = {
      index_file: config.index_file
        ? { path: config.index_file, commits_90d: indexCommits }
        : null,
      entry_files: entryEntries,
      median_commits_90d,
      ratio:
        indexCommits !== null && median_commits_90d > 0
          ? Number((indexCommits / median_commits_90d).toFixed(2))
          : null,
      top5: [...perDoc].sort((a, b) => b.commits_90d - a.commits_90d || a.path.localeCompare(b.path)).slice(0, 5),
    };
  } else {
    notes.push('無 git，index_hotness 無法量測');
  }

  const out = {
    scope: null,
    scenarios,
    areas,
    code_pointer_ratio,
    index_hotness,
  };
  if (notes.length) out.note = notes.join('；');

  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
} catch (err) {
  fail(err.message);
}
