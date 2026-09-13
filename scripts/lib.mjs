// scripts/lib.mjs — shared module for docgrad's measurement scripts (zero dependencies, Node >=18)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const CONFIG_FILENAME = '.docgrad.yml';

// --- YAML subset parser ---------------------------------------------------------
// Only supports the two-level structure .docgrad.yml needs: top-level scalar / inline list /
// block list / one level of nested map. Not a general-purpose YAML parser.

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
  let nestedKey = null; // the top-level key currently being expanded (nested map or block list)
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    const content = stripComment(raw.trim()).trim();
    if (!content) continue;
    if (indent === 0) {
      const m = content.match(/^([^:]+):\s*(.*)$/);
      if (!m) throw new Error(`Could not parse config line: ${raw}`);
      const key = m[1].trim();
      const rest = m[2].trim();
      if (rest === '') {
        nestedKey = key;
        root[key] = {}; // becomes an array once a "- " line is encountered
      } else {
        nestedKey = null;
        root[key] = rest.startsWith('[') ? parseInlineList(rest) : parseScalar(rest);
      }
    } else {
      if (nestedKey === null) throw new Error(`Bad indentation level: ${raw}`);
      if (content.startsWith('- ')) {
        if (!Array.isArray(root[nestedKey])) root[nestedKey] = [];
        root[nestedKey].push(parseScalar(content.slice(2)));
      } else {
        const m = content.match(/^([^:]+):\s*(.*)$/);
        if (!m) throw new Error(`Could not parse config line: ${raw}`);
        const rest = m[2].trim();
        root[nestedKey][m[1].trim()] = rest.startsWith('[') ? parseInlineList(rest) : parseScalar(rest);
      }
    }
  }
  return root;
}

// --- Config loading --------------------------------------------------------------

const DEFAULTS = {
  docs_dirs: ['docs/'],
  // docs_files: a **single** markdown file outside docs_dirs, included in the corpus as a regular
  // document (type: 'doc'). It differs from entry_files in "when it's loaded", not "how important
  // it is" — see item 3 of the questionnaire in reference/init.md.
  docs_files: [],
  entry_files: [],
  index_file: null,
  exclude: [],
  src_dirs: [],
  // convention can be a single value or a comma/`+`-separated list of values (see
  // parseFreshnessConventions); heading_field is the inline keyword used for a heading-line;
  // falls back to field when unset (compatibility with older configs).
  freshness: { convention: 'none', field: null, heading_field: null, stale_after_days: 60 },
  coverage: { drift_after_days: 30, min_commits: 3 },
  targets: { completeness: 4, correctness: 4, freshness: 4, linkage: 4, consistency: 4, economy: 4 },
  // Thresholds for the economy anchors (added in v1.0.0). Changing these = changing the meaning
  // of a rubric anchor = major, see reference/rubric.md.
  economy: { entry_cost_tiers: [20000, 10000, 5000, 3000], pollution_max: 0.1 },
  correctness_sample: 8,
  scenario: null,
  scenarios: [], // used by retrieval.mjs: list of representative code paths (files or dirs), report-only
  rules: { pattern: '**MUST' }, // used by inventory.mjs structure.rules: the string that marks a rule line
  language: 'zh-TW',
};

// configFile can be external (--config): for when the doc source itself can't take a written file
// (an export directory, a read-only mount) and you want to point at a config file elsewhere.
export function loadConfig(rootDir, configFile = path.join(rootDir, CONFIG_FILENAME)) {
  if (!fs.existsSync(configFile)) {
    throw new Error(`Could not find ${configFile} (root: ${rootDir}). Run /docgrad init first.`);
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
    throw new Error(`freshness.field must be set when freshness.convention is ${config.freshness.convention}`);
  }
  return config;
}

// --- CLI shared -------------------------------------------------------------------

// Legacy interface that only recognizes --root and falls back to cwd when it's missing;
// all four CLIs now use parseArgs() instead.
export function resolveRoot(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--root');
  return path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd());
}

function takeValue(argv, i, flag) {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${flag} requires a value`);
  return v;
}

// Flags shared by all four scripts:
//   --root <dir>      target repo root (default: cwd)
//   --config <file>   config file path (default: <root>/.docgrad.yml)
//   --include <glob>  limit scope (scoped audit), repeatable or comma-separated; omit = full scope
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
    } else throw new Error(`Unknown argument ${a} (supported: --root / --config / --include)`);
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

// --- File inventory ----------------------------------------------------------

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

// --- scope filtering (--include) --------------------------------------------------
// Supports `**` (crosses levels), `*` (same level), `?` (single character); a pattern without
// these characters is treated as a path prefix (`docs/infra` => the file itself and everything
// under it). An empty scope = full scope, no filtering.

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
          re += '(?:.*/)?'; // a/**/b must also match a/b
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

// Shared inclusion rule for single-file entries (docs_files / entry_files / index_file):
//   - doesn't exist -> silently skip (`.docgrad.yml` is version-controlled and shared across
//     branches; a temporarily missing file shouldn't crash the whole script).
//   - points at a directory -> throw explicitly. Otherwise the error would surface later, when
//     inventory.mjs reads the file, as an unhelpful `EISDIR: illegal operation on a directory`
//     (the mirror image of the ENOTDIR you get when a single file is mistakenly put in docs_dirs).
//   - already included -> don't push a duplicate (when the same file is listed both in this field
//     and in what docs_dirs scanned up, it only counts once).
function pushSingleFile(rootDir, rel, field, out) {
  if (!rel) return;
  const abs = path.join(rootDir, rel);
  if (!fs.existsSync(abs)) return;
  if (fs.statSync(abs).isDirectory()) {
    throw new Error(`${field} may only list a single file, but ${rel} is a directory — put the whole directory in docs_dirs instead`);
  }
  if (!out.includes(rel)) out.push(rel);
}

export function collectFiles(rootDir, config, { include = [] } = {}) {
  const all = [];
  for (const dir of config.docs_dirs) {
    const abs = path.join(rootDir, dir);
    if (fs.existsSync(abs)) walkMarkdown(abs, rootDir, all);
  }
  // docs_files: single files outside docs_dirs that are semantically **regular documents**
  // (typically a repo-root PRODUCT.md/DESIGN.md — a must-read that's conditionally loaded).
  // They aren't picked up by docs_dirs' directory scan, and putting a single file in docs_dirs
  // would blow up (ENOTDIR); listing them as entry_files would get them in, but inventory.mjs's
  // fileType() would tag them as 'entry' and inflate the fixed cost (measured on oikos:
  // 9,037 -> 21,474 tokens, economy ★3 -> ★1), which also contradicts audit.md's requirement
  // that entry_cost.files really be loaded on every single task. Hence a separate field.
  for (const f of config.docs_files) pushSingleFile(rootDir, f, 'docs_files', all);
  // entry_files and index_file may fall outside docs_dirs (e.g. a repo-root SKILL.md/README.md);
  // both are part of the documentation system and must be included in the corpus — missing
  // index_file would get it filtered out of links.mjs's roots (roots only recognizes paths
  // within includedSet), and the whole subtree reachable only from the index would be
  // misjudged as orphans.
  for (const f of config.entry_files) pushSingleFile(rootDir, f, 'entry_files', all);
  pushSingleFile(rootDir, config.index_file, 'index_file', all);
  const isExcluded = (p) =>
    config.exclude.some((ex) => p === ex || p.startsWith(ex.endsWith('/') ? ex : `${ex}/`));
  const inScope = (p) => matchesScope(p, include);
  return {
    included: all.filter((p) => !isExcluded(p) && inScope(p)).sort(),
    excluded: all.filter((p) => isExcluded(p) && inScope(p)).sort(),
  };
}

// --- Token estimation (heuristic coefficients: CJK 1.1 tokens/char, everything else 1 token/4 chars) ------------------

export const CJK_TOKENS_PER_CHAR = 1.1;
export const NON_CJK_CHARS_PER_TOKEN = 4;
export const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;
const CJK_RE_G = new RegExp(CJK_RE.source, 'g');

export function estimateTokens(text) {
  const cjk = (text.match(CJK_RE_G) || []).length;
  return Math.round(cjk * CJK_TOKENS_PER_CHAR + (text.length - cjk) / NON_CJK_CHARS_PER_TOKEN);
}

// --- markdown parsing ------------------------------------------------------------

// GitHub's slug turns **each individual space** into one dash — it doesn't collapse a run of
// spaces into one. The two only diverge when stripping punctuation leaves adjacent spaces
// behind, and that's exactly how Chinese headings are most often written:
// `## 狀態圖例 (status / sot_level legend)` -> GitHub gives `狀態圖例-status--sot_level-legend`
// (double dash). The old implementation collapsed `\s+` into a single dash, so every link of
// this shape was falsely reported as a bad anchor (5 of the 18 bad_anchors measured on kdan-bpm
// on 2026-09-05 were of this kind). Matching github-slugger's behavior fixes it.
export function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

// Explicit anchors `<a id="x"></a>` / `<a name="x"></a>` — a heading's slug changes when the
// heading is rewritten, so long-lived links often switch to an explicit anchor instead. The old
// implementation only recognized `#` headings, so every link pointing at an explicit anchor was
// falsely reported as a bad anchor (13 of the 18 bad_anchors measured on kdan-bpm on 2026-09-05
// were of this kind).
const EXPLICIT_ANCHOR_RE = /<a\s[^>]*\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;

export function extractHeadings(text) {
  const counts = new Map();
  const slugs = new Set();
  for (const line of text.split(/\r?\n/)) {
    for (const m of line.matchAll(EXPLICIT_ANCHOR_RE)) slugs.add(m[1].trim());
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    // Strip markdown emphasis markers from the heading before computing the slug. `_` needs two
    // cases: GFM's word-internal underscore is not emphasis (`sot_level` is literal, and GitHub's
    // slug keeps it) — only an `_` with non-alphanumeric characters on both sides is a delimiter.
    // The old implementation stripped it unconditionally, so
    // `## 狀態圖例 (status / sot_level legend)` was computed as `…-sotlevel-…`, and every link
    // pointing at that section was falsely reported as a bad anchor.
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

// --- Freshness date extraction --------------------------------------------------

const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

// convention accepts a single value or a comma/`+`-separated list of values
// ("frontmatter,heading-line" or "frontmatter+heading-line"); unset/falsy is always treated as 'none'.
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
    // Falls back to field when heading_field is unset (an old config that only sets field but
    // wants heading-line behavior).
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

// Tries each convention in the list in order; the first date extracted wins.
export function extractClaimedDate(text, freshness) {
  for (const convention of parseFreshnessConventions(freshness.convention)) {
    const date = extractClaimedDateOne(text, convention, freshness);
    if (date) return date;
  }
  return null;
}

// --- code anchor extraction (used by retrieval.mjs / inventory.mjs) ------------------------------
// The convention in docs/how-to.md §citing code: inside a backtick span, use `path › symbol()`,
// never a line number. Both forms are recognized:
//   1. Inside a single backtick span, a path starting with any of srcDirs' prefixes, with an
//      optional " › symbol": `apps/api/src/foo/bar.ts`, `scripts/lib.mjs › DEFAULTS.targets`
//   2. A bare filename (no path prefix; the caller matches it against a real file's basename):
//      `bar.ts`, also recognizing two backtick spans joined by "›": `bar.ts` › `sym()`
// Only extracted outside code fences, to avoid matching example code. Directory names aren't
// hardcoded — srcDirs is passed in by the caller.
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
  // Normalize two backtick spans joined by "›" into a single span first, then run everything
  // through the same parsing path.
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
    if (!pathPart || /\s/.test(pathPart)) continue; // not a path-shaped token (ordinary inline code)
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

// --- docgrad's own version fingerprint (used for history.jsonl's comparability fields) ----------------
//
// rubric_hash is the fingerprint of "the ruler this round used": every edit to rubric.md changes
// the hash, and the report draws a comparability break based on it. The first 8 characters are
// enough to distinguish (collision probability is negligible), and it keeps each history line
// from getting too long.

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function docgradMeta(skillRoot = SKILL_ROOT) {
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(skillRoot, '.claude-plugin/plugin.json'), 'utf8')).version ?? null;
  } catch {
    version = null; // allowed to be missing when run from outside the source tree; don't let it crash the script
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

// --- Concrete claim candidates ------------------------------------------------------
//
// A "concrete claim" = a line outside a fence that has code coordinates to check against
// (extractCodeRefs can extract a ref from it). A plain descriptive sentence has no coordinates
// to extract and shouldn't enter the claim ledger in the first place — the rubric's weighted
// sampling rule for correctness (prefer sampling lines with a path/symbol) becomes mechanically
// reproducible this way, instead of being freely re-picked by an LLM each round. Heading lines
// are excluded: a heading is navigation, not a claim.
export function extractClaimLines(text, srcDirs = []) {
  const lines = text.split(/\r?\n/);

  // Split into sections first: each heading opens a new section, and the section range tells a
  // verifier "how far to read". This step is necessary, not just convenient — contradictions
  // often show up **in the sentence next to the anchor line**, not the anchor line itself: on
  // oikos, that balance sign was written in the sentence right after "settlement is handled by
  // `src/balance.ts › settle()`", and checking only the anchor line missed the whole thing
  // entirely (the pattern behind the ★4->★2 re-verification after wrap-up on 2026-07-13).
  const sections = [];
  let inFence = false;
  let current = { title: null, start: 1, end: lines.length };
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const m = lines[i].match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    current.end = i; // the previous section ends right before the heading line
    sections.push(current);
    current = { title: m[1].replace(/[*_`]/g, '').trim(), start: i + 2, end: lines.length };
  }
  sections.push(current);
  const sectionOf = (lineNo) =>
    sections.find((s) => lineNo >= s.start && lineNo <= s.end) ?? sections.at(-1);

  const out = [];
  inFence = false;
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
    const sec = sectionOf(i + 1);
    out.push({
      line: i + 1,
      text: line.trim(),
      refs: refs.length,
      section: sec.title,
      // verification range: the whole section, not just this one line.
      section_lines: [sec.start, sec.end],
    });
  }
  return out;
}

// Aggregates claim candidates across files with a **stable** ordering: more refs comes first
// (the more specific the claim, the more it deserves verification), ties broken by path, then by
// line — the order this produces from the same corpus is always the same, so sampling is
// reproducible.
export function rankClaimCandidates(perFile) {
  return perFile
    .flatMap(({ path: p, claims }) => claims.map((c) => ({ path: p, ...c })))
    .sort((a, b) => b.refs - a.refs || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line);
}
