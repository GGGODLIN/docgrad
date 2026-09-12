// scripts/lib.mjs — docgrad 量測腳本共用模組（零依賴，Node ≥18）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const CONFIG_FILENAME = '.docgrad.yml';

// --- YAML 子集解析 ---------------------------------------------------------
// 只支援 .docgrad.yml 需要的兩層結構：頂層 scalar / inline list / block list /
// 一層 nested map。不是通用 YAML parser。

function stripComment(s) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s;
}

function parseScalar(v) {
  v = v.trim();
  if (v === '' || v === 'null' || v === '~') return null;
  if ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'")) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function parseInlineList(v) {
  const inner = v.slice(1, -1).trim();
  return inner === '' ? [] : inner.split(',').map((s) => parseScalar(s));
}

export function parseYamlSubset(text) {
  const root = {};
  let nestedKey = null; // 目前展開中的頂層 key（nested map 或 block list）
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    const content = stripComment(raw.trim()).trim();
    if (!content) continue;
    if (indent === 0) {
      const m = content.match(/^([^:]+):\s*(.*)$/);
      if (!m) throw new Error(`無法解析設定行: ${raw}`);
      const key = m[1].trim();
      const rest = m[2].trim();
      if (rest === '') {
        nestedKey = key;
        root[key] = {}; // 遇到 "- " 時轉成 array
      } else {
        nestedKey = null;
        root[key] = rest.startsWith('[') ? parseInlineList(rest) : parseScalar(rest);
      }
    } else {
      if (nestedKey === null) throw new Error(`縮排層級錯誤: ${raw}`);
      if (content.startsWith('- ')) {
        if (!Array.isArray(root[nestedKey])) root[nestedKey] = [];
        root[nestedKey].push(parseScalar(content.slice(2)));
      } else {
        const m = content.match(/^([^:]+):\s*(.*)$/);
        if (!m) throw new Error(`無法解析設定行: ${raw}`);
        const rest = m[2].trim();
        root[nestedKey][m[1].trim()] = rest.startsWith('[') ? parseInlineList(rest) : parseScalar(rest);
      }
    }
  }
  return root;
}

// --- 設定載入 --------------------------------------------------------------

const DEFAULTS = {
  docs_dirs: ['docs/'],
  entry_files: [],
  index_file: null,
  exclude: [],
  src_dirs: [],
  // convention 可為單值或逗號/`+` 分隔的多值（見 parseFreshnessConventions）；
  // heading_field 是 heading-line 用的行內關鍵字，未設時 fallback 用 field（相容舊設定）。
  freshness: { convention: 'none', field: null, heading_field: null, stale_after_days: 60 },
  coverage: { drift_after_days: 30, min_commits: 3 },
  targets: { completeness: 4, correctness: 4, freshness: 4, linkage: 4, consistency: 4, economy: 4 },
  // 經濟性錨點的門檻（v1.0.0 新增）。改這裡＝改 rubric 錨點語意＝major，見 reference/rubric.md。
  economy: { entry_cost_tiers: [20000, 10000, 5000, 3000], pollution_max: 0.1 },
  correctness_sample: 8,
  scenario: null,
  scenarios: [], // retrieval.mjs 用：代表性 code 路徑（檔案或目錄）清單，report-only
  rules: { pattern: '**MUST' }, // inventory.mjs structure.rules 用：規則行判定字串
  language: 'zh-TW',
};

// configFile 可外置（--config）：文件源本身不能落檔時（匯出目錄、唯讀掛載）指定別處的設定檔。
export function loadConfig(rootDir, configFile = path.join(rootDir, CONFIG_FILENAME)) {
  if (!fs.existsSync(configFile)) {
    throw new Error(`找不到 ${configFile}（root: ${rootDir}），請先執行 /docgrad init`);
  }
  const parsed = parseYamlSubset(fs.readFileSync(configFile, 'utf8'));
  const config = {
    ...DEFAULTS,
    ...parsed,
    freshness: { ...DEFAULTS.freshness, ...(parsed.freshness ?? {}) },
    coverage: { ...DEFAULTS.coverage, ...(parsed.coverage ?? {}) },
    targets: { ...DEFAULTS.targets, ...(parsed.targets ?? {}) },
    rules: { ...DEFAULTS.rules, ...(parsed.rules ?? {}) },
  };
  const needsField = parseFreshnessConventions(config.freshness.convention).some(
    (c) => c === 'frontmatter' || c === 'heading-line'
  );
  if (needsField && !config.freshness.field) {
    throw new Error(`freshness.convention 為 ${config.freshness.convention} 時必須設定 freshness.field`);
  }
  return config;
}

// --- CLI 共用 ---------------------------------------------------------------

// 只認 --root、缺值退回 cwd 的舊介面；四支 CLI 一律改用 parseArgs()。
export function resolveRoot(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--root');
  return path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd());
}

function takeValue(argv, i, flag) {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${flag} 需要一個參數值`);
  return v;
}

// 四支腳本共用旗標：
//   --root <dir>      目標 repo 根（預設 cwd）
//   --config <file>   設定檔路徑（預設 <root>/.docgrad.yml）
//   --include <glob>  限定範圍（scoped audit），可重複或逗號分隔；不給＝全量
export function parseArgs(argv = process.argv.slice(2)) {
  let rootArg = null;
  let configArg = null;
  const include = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') rootArg = takeValue(argv, i++, '--root');
    else if (a === '--config') configArg = takeValue(argv, i++, '--config');
    else if (a === '--include') {
      include.push(...takeValue(argv, i++, '--include').split(',').map((s) => s.trim()).filter(Boolean));
    } else throw new Error(`未知參數 ${a}（支援 --root / --config / --include）`);
  }
  const root = path.resolve(rootArg ?? process.cwd());
  return {
    root,
    configFile: configArg ? path.resolve(configArg) : path.join(root, CONFIG_FILENAME),
    include,
  };
}

export function fail(message) {
  process.stderr.write(`docgrad: ${message}\n`);
  process.exit(1);
}

// --- 檔案盤點 ----------------------------------------------------------------

const MD_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);
const ALWAYS_SKIP_DIRS = new Set(['node_modules', '.git']);

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function walkMarkdown(absDir, rootDir, out) {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
      walkMarkdown(path.join(absDir, entry.name), rootDir, out);
    } else if (MD_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(toPosix(path.relative(rootDir, path.join(absDir, entry.name))));
    }
  }
}

// --- scope 過濾（--include）--------------------------------------------------
// 支援 `**`（跨層）、`*`（同層）、`?`（單字元）；不含這些字元的 pattern 視為路徑前綴
// （`docs/infra` ⇒ 該檔本身與其下所有檔案）。scope 為空＝全量，不過濾。

const GLOB_CHARS = /[*?]/;

export function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i += 1;
        if (pattern[i + 1] === '/') {
          i += 1;
          re += '(?:.*/)?'; // a/**/b 也要匹配 a/b
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesScope(relPath, include = []) {
  if (include.length === 0) return true;
  return include.some((raw) => {
    const p = raw.replace(/^\.\//, '');
    if (GLOB_CHARS.test(p)) return globToRegExp(p).test(relPath);
    const dir = p.endsWith('/') ? p : `${p}/`;
    return relPath === p || relPath.startsWith(dir);
  });
}

export function collectFiles(rootDir, config, { include = [] } = {}) {
  const all = [];
  for (const dir of config.docs_dirs) {
    const abs = path.join(rootDir, dir);
    if (fs.existsSync(abs)) walkMarkdown(abs, rootDir, all);
  }
  // entry_files 與 index_file 可能落在 docs_dirs 之外（如 repo 根的 SKILL.md／README.md），
  // 兩者都是文件體系的一部分，必須納入語料——index_file 漏收會讓它被 links.mjs 的
  // roots 過濾掉（roots 只認 includedSet 內的路徑），整棵只從索引可達的子樹被誤判成孤兒。
  for (const f of [...config.entry_files, config.index_file]) {
    if (f && fs.existsSync(path.join(rootDir, f)) && !all.includes(f)) all.push(f);
  }
  const isExcluded = (p) =>
    config.exclude.some((ex) => p === ex || p.startsWith(ex.endsWith('/') ? ex : `${ex}/`));
  const inScope = (p) => matchesScope(p, include);
  return {
    included: all.filter((p) => !isExcluded(p) && inScope(p)).sort(),
    excluded: all.filter((p) => isExcluded(p) && inScope(p)).sort(),
  };
}

// --- token 估算（啟發式係數：CJK 每字 1.1、其餘每 4 字元 1）------------------

export const CJK_TOKENS_PER_CHAR = 1.1;
export const NON_CJK_CHARS_PER_TOKEN = 4;
export const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;
const CJK_RE_G = new RegExp(CJK_RE.source, 'g');

export function estimateTokens(text) {
  const cjk = (text.match(CJK_RE_G) || []).length;
  return Math.round(cjk * CJK_TOKENS_PER_CHAR + (text.length - cjk) / NON_CJK_CHARS_PER_TOKEN);
}

// --- markdown 解析 ------------------------------------------------------------

// GitHub 的 slug 是**逐個空白**換成一個 dash，不是把連續空白收成一個。
// 兩者只在「標點被移除後留下相鄰空白」時分歧，而中文標題最常這樣寫：
// `## 狀態圖例 (status / sot_level legend)` → GitHub 給 `狀態圖例-status--sot_level-legend`（雙 dash）。
// 舊實作用 `\s+` 收成單 dash，於是所有這型連結都被誤報成壞錨（2026-09-05 在 kdan-bpm 量到 18 筆 bad_anchors
// 有 5 筆屬此類）。與 github-slugger 的行為對齊即可消除。
export function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

// 顯式錨點 `<a id="x"></a>` / `<a name="x"></a>`——標題會隨改寫而變 slug，長期連結因此
// 常改用顯式錨。舊實作只認 `#` 標題，於是指向顯式錨的連結一律被誤報成壞錨
// （2026-09-05 在 kdan-bpm 量到 18 筆 bad_anchors 有 13 筆屬此類）。
const EXPLICIT_ANCHOR_RE = /<a\s[^>]*\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;

export function extractHeadings(text) {
  const counts = new Map();
  const slugs = new Set();
  for (const line of text.split(/\r?\n/)) {
    for (const m of line.matchAll(EXPLICIT_ANCHOR_RE)) slugs.add(m[1].trim());
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    // 去掉標題裡的 markdown 強調符號後才算 slug。`_` 要分兩種：GFM 的**詞內底線不是強調**
    // （`sot_level` 是字面值，GitHub 的 slug 會保留），只有兩側非文數字的 `_` 才是分隔符。
    // 舊實作一律移除，於是 `## 狀態圖例 (status / sot_level legend)` 被算成 `…-sotlevel-…`，
    // 指向該節的連結全被誤報成壞錨。
    const base = githubSlug(
      m[1].replace(/[*`]/g, '').replace(/_(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_/gu, '')
    );
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export function extractLinks(text) {
  const links = [];
  let inFence = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    for (const m of line.matchAll(LINK_RE)) links.push({ target: m[1], line: i + 1 });
  });
  return links;
}

// --- 新鮮度日期抽取 --------------------------------------------------------

const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

// convention 接受單值或逗號/`+` 分隔的多值（"frontmatter,heading-line" 或
// "frontmatter+heading-line"）；未設定/假值一律視為 'none'。
export function parseFreshnessConventions(convention) {
  if (!convention) return ['none'];
  return String(convention)
    .split(/[,+]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractClaimedDateOne(text, convention, freshness) {
  if (convention === 'frontmatter') {
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return null;
    const line = fm[1].split(/\r?\n/).find((l) => l.trimStart().startsWith(`${freshness.field}:`));
    const m = line && line.match(DATE_RE);
    return m ? m[1] : null;
  }
  if (convention === 'heading-line') {
    // heading_field 未設時 fallback 用 field（只設 field 就想吃 heading-line 的舊設定）。
    const field = freshness.heading_field ?? freshness.field;
    if (!field) return null;
    for (const line of text.split(/\r?\n/).slice(0, 30)) {
      if (line.includes(field)) {
        const m = line.match(DATE_RE);
        if (m) return m[1];
      }
    }
  }
  return null;
}

// 依 convention 清單依序嘗試，第一個抽到的日期為準。
export function extractClaimedDate(text, freshness) {
  for (const convention of parseFreshnessConventions(freshness.convention)) {
    const date = extractClaimedDateOne(text, convention, freshness);
    if (date) return date;
  }
  return null;
}

// --- code 錨點抽取（retrieval.mjs／inventory.mjs 用）------------------------------
// docs/how-to.md §引用 code 的錨點慣例：backtick 內用 `path › symbol()`，不用行號。
// 兩種形式都認：
//   1. 單一 backtick 內、以任一 srcDirs 前綴開頭的路徑，可選 " › symbol"：
//      `apps/api/src/foo/bar.ts`、`scripts/lib.mjs › DEFAULTS.targets`
//   2. 裸檔名（無路徑前綴，靠呼叫端以實際檔案 basename 比對）：`bar.ts`，
//      也認兩個 backtick span 中間夾 "›" 的寫法：`bar.ts` › `sym()`
// 只在非 code fence 內抽取，避免命中範例程式碼。不寫死目錄名——srcDirs 由呼叫端傳入。
const CODE_REF_RE = /`([^`\n]+)`/g;
const TWO_SPAN_ARROW_RE = /`([^`\n]+)`\s*›\s*`([^`\n]+)`/g;

export function extractCodeRefs(text, srcDirs = []) {
  const prefixes = srcDirs.map((d) => d.replace(/\/+$/, '')).filter(Boolean);

  const lines = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) lines.push(line);
  }
  // 兩個 backtick span 夾 "›" 先正規化成單一 span，統一走同一套解析。
  const body = lines.join('\n').replace(TWO_SPAN_ARROW_RE, (_, p, s) => `\`${p} › ${s}\``);

  const refs = [];
  for (const m of body.matchAll(CODE_REF_RE)) {
    const raw = m[1].trim();
    if (!raw) continue;
    let pathPart = raw;
    let symbol = null;
    const arrowIdx = raw.indexOf('›');
    if (arrowIdx >= 0) {
      pathPart = raw.slice(0, arrowIdx).trim();
      symbol = raw.slice(arrowIdx + 1).trim() || null;
    }
    pathPart = pathPart.replace(/^['"]|['"]$/g, '');
    if (!pathPart || /\s/.test(pathPart)) continue; // 不是路徑形狀的 token（一般行內 code）
    const hasPrefix = prefixes.some((p) => pathPart === p || pathPart.startsWith(`${p}/`));
    const looksLikeFile = /\.[A-Za-z0-9]{1,10}$/.test(pathPart);
    if (hasPrefix) {
      refs.push({ path: pathPart, symbol, basenameOnly: false });
    } else if (!pathPart.includes('/') && looksLikeFile) {
      refs.push({ path: pathPart, symbol, basenameOnly: true });
    }
  }
  return refs;
}

// --- docgrad 自身的版本指紋（history.jsonl 的可比性欄位用）----------------------
//
// rubric_hash 是「這一輪用的尺」的指紋：rubric.md 一改，hash 就變，report 據此畫
// 可比性斷點。取前 8 碼夠分辨（碰撞機率可忽略），也讓 history 每行不至於太長。

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function docgradMeta(skillRoot = SKILL_ROOT) {
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(skillRoot, '.claude-plugin/plugin.json'), 'utf8')).version ?? null;
  } catch {
    version = null; // 從 source tree 以外的方式執行時允許缺，不讓整支腳本炸掉
  }
  let rubricHash = null;
  try {
    const rubric = fs.readFileSync(path.join(skillRoot, 'reference/rubric.md'), 'utf8');
    rubricHash = createHash('sha256').update(rubric, 'utf8').digest('hex').slice(0, 8);
  } catch {
    rubricHash = null;
  }
  return { version, rubric_hash: rubricHash };
}

// --- 具體宣稱（claim）候選 ------------------------------------------------------
//
// 「具體宣稱」＝fence 外、帶得到 code 座標的那些行（extractCodeRefs 抽得到 ref）。
// 純敘述句抽不到座標，本來就不該進 claim-ledger——rubric 正確性的加權抽樣規則
// （優先抽含路徑/符號者）於是變成機械可重現的，而不是每輪由 LLM 重新自由挑。
// 標題行排除：標題是導航不是宣稱。
export function extractClaimLines(text, srcDirs = []) {
  const out = [];
  let inFence = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\s*#{1,6}\s/.test(line)) continue;
    if (!line.trim()) continue;
    const refs = extractCodeRefs(line, srcDirs);
    if (!refs.length) continue;
    out.push({ line: i + 1, text: line.trim(), refs: refs.length });
  }
  return out;
}

// 跨檔彙總 claim 候選並給一個**穩定**排序：ref 多的優先（宣稱越具體越該驗），
// 同分依 path、再依 line——同一份語料每次跑出來的順序一定相同，抽樣才可重現。
export function rankClaimCandidates(perFile) {
  return perFile
    .flatMap(({ path: p, claims }) => claims.map((c) => ({ path: p, ...c })))
    .sort((a, b) => b.refs - a.refs || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line);
}
