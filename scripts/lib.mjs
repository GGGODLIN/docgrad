// scripts/lib.mjs — shared module for docgrad's measurement scripts (zero dependencies, Node >=18)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  // exclude_untracked: opt-in, default false (= today's behavior). When true, collectFiles drops
  // every collected file that git does not track, so the corpus matches a clean checkout of the
  // same commit. This is strictly about **tracked vs. untracked**; it says nothing about what
  // `exclude` means — a deliberately scoped-out directory is still charged to the pollution
  // surface exactly as before.
  exclude_untracked: false,
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

// --- Config field type validation -------------------------------------------------
//
// A scalar written where a list belongs (`docs_files: PRODUCT.md`, missing the brackets) used to
// be iterated **character by character** by the `for…of` loops in collectFiles: every single
// character was tried as a path, every existsSync failed, and the corpus silently came back
// without those files. The only symptom was that files_total didn't move — and nobody connects
// "the number didn't change" to "the config is malformed", least of all right after adding a
// field and expecting the number to grow.
//
// So: fail loudly, and cover every list field in one pass (validating only the newest field would
// leave the older ones inconsistent). Deliberately **not** auto-wrapping a scalar into a
// one-element list: a silent repair leaves the config still wrong in a version-controlled file,
// for the next reader to trip over again.

const LIST_FIELD_EXAMPLES = {
  docs_dirs: 'docs/',
  docs_files: 'PRODUCT.md',
  entry_files: 'CLAUDE.md',
  exclude: 'docs/archive/',
  src_dirs: 'src/',
  scenarios: 'src/foo/bar.ts',
};

const BOOL_FIELD_EXAMPLES = {
  exclude_untracked: 'true',
};

function describeValue(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') {
    return Object.keys(v).length === 0
      ? 'an empty value (nothing after the colon, and no "- " item under it)'
      : 'a map';
  }
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`;
  return `the ${typeof v} ${JSON.stringify(v)}`;
}

const PATH_FIELD_EXAMPLES = { index_file: 'docs/README.md' };

export function validateConfigTypes(config, configFile = CONFIG_FILENAME) {
  for (const [field, example] of Object.entries(LIST_FIELD_EXAMPLES)) {
    const value = config[field];
    if (!Array.isArray(value)) {
      throw new Error(
        `${configFile}: ${field} must be a list, but got ${describeValue(value)}. ` +
          `Write it as an inline list — ${field}: [${example}] — or as a block list with one "- " item per line. ` +
          `A bare scalar would be iterated character by character and collect nothing at all.`
      );
    }
    const bad = value.findIndex((e) => typeof e !== 'string' || e.trim() === '');
    if (bad >= 0) {
      throw new Error(
        `${configFile}: ${field}[${bad}] must be a non-empty path string, but got ${describeValue(value[bad])}. ` +
          `Correct form: ${field}: [${example}]`
      );
    }
  }
  for (const [field, example] of Object.entries(BOOL_FIELD_EXAMPLES)) {
    const value = config[field];
    if (typeof value !== 'boolean') {
      throw new Error(
        `${configFile}: ${field} must be true or false, but got ${describeValue(value)}. ` +
          `Correct form: ${field}: ${example}`
      );
    }
  }
  // Single-path fields fail the same way list fields used to: a key written with nothing after the
  // colon parses to {} and only surfaces much later as a raw TypeError out of path.join(). Null is
  // legitimate here (it means "this repo has no index"), an object never is.
  for (const [field, example] of Object.entries(PATH_FIELD_EXAMPLES)) {
    const value = config[field];
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(
        `${configFile}: ${field} must be a path string or null, but got ${describeValue(value)}. ` +
          `Write ${field}: ${example}, or ${field}: null when the repo has none. ` +
          `A key with nothing after the colon parses as an empty mapping, not as null.`
      );
    }
  }
  return config;
}

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
  validateConfigTypes(config, configFile);
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

// --- git: which collected files does git actually track? ----------------------------
//
// collectFiles walks the filesystem, it does not ask git. So an untracked local file sitting
// inside the corpus changes pollution.ratio — and the pollution surface is a **rated** input
// (economy.pollution_max forces a downgrade once it is exceeded). Measured on one repo at the
// same commit, same script version: ratio 0.1066 in a working checkout vs 0.0517 in a clean
// worktree, the whole difference being a single untracked 9,730-token draft in a .gitignore'd
// directory. pollution_max sits at 0.10, i.e. **between the two numbers**: two people can rate
// the same commit differently, which is precisely the class of problem docgrad exists to catch.
//
// Classification is by the complement of the **tracked** set (`git ls-files`), not by
// `git ls-files --others --exclude-standard`: the draft that produced the measurement above lives
// in a .gitignore'd directory, so it is untracked *and* ignored, and --exclude-standard would
// filter it straight back out. "Not in git" is the property that matters here, and an ignored
// file has it.
export function gitTrackedFiles(rootDir) {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return new Set(out.split('\0').filter(Boolean)); // git already prints posix separators
  } catch {
    return null; // not a git work tree / git not installed — callers must report null, never zero
  }
}

const NO_GIT = 'git is unavailable or this is not a git working tree';
export const GIT_UNAVAILABLE_NOTE =
  `${NO_GIT}: tracked and untracked files cannot be told apart, so this is null rather than zero`;

// tracked: pass a Set from gitTrackedFiles() to reuse one git call; undefined = look it up when
// config.exclude_untracked needs it; null = caller already established git is unavailable.
export function collectFiles(rootDir, config, { include = [], tracked } = {}) {
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
  // Filter before the exclude/scope split, so the pollution surface's numerator *and* denominator
  // both describe the same clean-checkout corpus.
  let collected = all;
  if (config.exclude_untracked) {
    const trackedSet = tracked === undefined ? gitTrackedFiles(rootDir) : tracked;
    if (trackedSet === null) {
      throw new Error(
        `exclude_untracked: true, but ${NO_GIT} — run inside a git working tree, or set exclude_untracked: false`
      );
    }
    collected = all.filter((p) => trackedSet.has(p));
  }
  const isExcluded = (p) =>
    config.exclude.some((ex) => p === ex || p.startsWith(ex.endsWith('/') ? ex : `${ex}/`));
  const inScope = (p) => matchesScope(p, include);
  return {
    included: collected.filter((p) => !isExcluded(p) && inScope(p)).sort(),
    excluded: collected.filter((p) => isExcluded(p) && inScope(p)).sort(),
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

// Strips the emphasis markers out of a heading before it is slugged, so the slug describes what
// GitHub actually *renders*. `*` and `` ` `` are stripped unconditionally. `_` is the hard case:
// GFM only treats it as an emphasis delimiter when it comes in a **matched pair** whose outer
// sides are non-alphanumeric and whose inner sides are not whitespace. A lone `_` sitting next to
// punctuation, or at the start of a word, is literal — GitHub keeps it in the slug.
//
//   `_emphasis_` / `__bold__` / `__init__` -> stripped (GitHub renders these as emphasis too)
//   `sot_level` / `cmd._args` / `_private` -> kept
//
// The previous implementation stripped an `_` whenever *either* neighbour was non-alphanumeric,
// which turned `### cmd._args` into `cmdargs` and `### _private` into `private` while GitHub
// produces `cmd_args` / `_private`. Every link pointing at such a section was reported as a bad
// anchor, and a bad anchor always costs a star — measured on tj/commander.js, the convergence
// loop went and added `<a id>` to a document that had nothing wrong with it (#42). The 0.6.1 fix
// only covered the word-internal case (`sot_level`); pairing is what covers all of them.
const EMPHASIS_PAIR_RE = /(?<![\p{L}\p{N}])(_{1,3})(?=[^\s_])(.+?)(?<=[^\s_])\1(?![\p{L}\p{N}])/gu;

export function stripHeadingEmphasis(heading) {
  return heading.replace(/[*`]/g, '').replace(EMPHASIS_PAIR_RE, '$2');
}

export function extractHeadings(text) {
  const counts = new Map();
  const slugs = new Set();
  for (const line of text.split(/\r?\n/)) {
    for (const m of line.matchAll(EXPLICIT_ANCHOR_RE)) slugs.add(m[1].trim());
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const base = githubSlug(stripHeadingEmphasis(m[1]));
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

// --- Source symbol index (the guard for API-shaped claim candidates) ---------------------------
//
// Library documentation describes an **API**, not a file tree. Measured on tj/commander.js,
// extractCodeRefs found a path-shaped span on exactly zero lines — `claims_total` was 0, so the
// correctness dimension had no mechanical basis at all, and the convergence loop then wrote new
// documents in docgrad's own `path › symbol()` house style and manufactured a population out of
// its own prose (#40).
//
// Recognising API-shaped inline code needs a guard, because prose is full of code-shaped words.
// The guard is existence: an identifier only counts if it actually occurs somewhere under
// src_dirs. That is one pass over src_dirs building a Set, never a grep per candidate — cost is
// O(bytes under src_dirs), read once per script run and then O(1) per lookup. Files above
// MAX_SRC_SYMBOL_FILE_BYTES are skipped: a minified bundle or a generated lockfile is both the most
// expensive thing in the tree and the worst possible symbol source (it would add every mangled
// name in the dependency graph to the set and blunt the guard).
//
// No src_dirs -> null -> the whole extension stays inert. Callers must report that, not hide it.

const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
export const MAX_SRC_SYMBOL_FILE_BYTES = 512 * 1024;

export function buildSrcSymbolIndex(rootDir, srcDirs = []) {
  const dirs = (Array.isArray(srcDirs) ? srcDirs : [])
    .map((d) => String(d).trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (!dirs.length) return null;

  const symbols = new Set();
  let filesScanned = 0;
  let filesSkipped = 0;
  let bytesScanned = 0;

  const visit = (absDir) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — the guard degrades, it must not crash the measurement
    }
    for (const entry of entries) {
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
        visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      let text;
      try {
        const { size } = fs.statSync(abs);
        if (size > MAX_SRC_SYMBOL_FILE_BYTES) {
          filesSkipped += 1;
          continue;
        }
        text = fs.readFileSync(abs, 'utf8');
        bytesScanned += size;
      } catch {
        filesSkipped += 1;
        continue;
      }
      if (text.includes('\0')) {
        filesSkipped += 1; // binary
        continue;
      }
      filesScanned += 1;
      for (const m of text.matchAll(IDENTIFIER_RE)) symbols.add(m[0]);
    }
  };

  for (const dir of dirs) {
    const abs = path.join(rootDir, dir);
    if (fs.existsSync(abs)) visit(abs);
  }
  return { symbols, files_scanned: filesScanned, files_skipped: filesSkipped, bytes_scanned: bytesScanned };
}

// API-shaped inline code. Three shapes are accepted, and each must be the *entire* content of one
// backtick span:
//   `foo()`                     bare call
//   `.option()` / `obj.method()`  member call (a leading dot is how JS API docs name a method)
//   `a.b` / `a.b.c`             dotted symbol with no call parens
//
// Deliberately NOT accepted:
//   - a bare identifier with neither a dot nor parens (`minWidthToWrap`). The existence check
//     cannot carry that shape on its own: a Set of every identifier under src_dirs contains
//     `data`, `name`, `true`, `value`, and inline code around those words is ordinary prose.
//     A real API claim about such a symbol is almost always written next to a call somewhere in
//     the same document, so the cost of excluding it is small and the false-positive saving large.
//   - a paren-less dotted span whose last segment looks like a file extension (`program.opts`,
//     `lib.mjs`). extractCodeRefs already emits those as basename path refs, and counting them
//     twice would inflate `refs` and silently reorder the candidate list.
const API_SPAN_RE = /^\.?([A-Za-z_$][A-Za-z0-9_$]*)((?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)(\(\s*\))?$/;
const BASENAME_TAIL_RE = /\.[A-Za-z0-9]{1,10}$/;

export function apiSpanSegments(raw) {
  const m = raw.match(API_SPAN_RE);
  if (!m) return null;
  const [, head, rest, call] = m;
  if (!call && !rest) return null; // bare identifier
  if (!call && BASENAME_TAIL_RE.test(raw)) return null; // already a basename path ref
  return rest ? [head, ...rest.slice(1).split('.')] : [head];
}

// symbols: a Set from buildSrcSymbolIndex().symbols. null/undefined => inert, returns [].
export function extractApiRefs(text, symbols) {
  if (!symbols || !symbols.size) return [];
  const refs = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const m of line.matchAll(CODE_REF_RE)) {
      const raw = m[1].trim();
      if (!raw || raw.includes('/') || raw.includes('›')) continue; // path territory, not API
      const segments = apiSpanSegments(raw);
      if (!segments) continue;
      // Every segment must exist under src_dirs, not just the last one. The existence check is
      // what makes this a signal rather than noise; requiring all of it is what keeps a documented
      // config key like `freshness.retention` from passing on the strength of one common word.
      if (!segments.every((s) => symbols.has(s))) continue;
      refs.push({ symbol: raw });
    }
  }
  return refs;
}

// --- git: which commit first added a file, and did docgrad write it? ---------------------------
//
// A correctness score built entirely on the tool's own prose is not worthless, but the reader has
// to be told. Measured on tj/commander.js after five convergence rounds: all 26 claim candidates
// came from the three documents docgrad itself had just written, and none from the seven
// pre-existing ones — the score went up while the repo's actual documentation debt was never
// sampled once.
//
// The signal is mechanical: the commit that *added* the file (oldest `--diff-filter=A`), and
// whether its subject carries docgrad's own `docs(docgrad):` prefix. One `git log` for the whole
// corpus rather than one per file; `--reverse` means the first time a path appears in the output
// is its add commit. Chunked so a very large corpus cannot overflow argv.
//
// null when git is unavailable — never false. "We could not tell" and "docgrad did not write it"
// are different statements, and collapsing them is how a disclosure field becomes a lie.

const GIT_PATHSPEC_CHUNK = 200;
const DOCGRAD_COMMIT_SUBJECT_RE = /^docs\(docgrad\)\s*:/;

export function gitAddCommitSubjects(rootDir, relPaths = []) {
  if (!relPaths.length) return new Map();
  const subjects = new Map();
  try {
    for (let i = 0; i < relPaths.length; i += GIT_PATHSPEC_CHUNK) {
      const chunk = relPaths.slice(i, i + GIT_PATHSPEC_CHUNK);
      const out = execFileSync(
        'git',
        ['log', '--reverse', '--diff-filter=A', '--name-only', '--format=%x00%s', '--', ...chunk],
        { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }
      );
      let subject = null;
      for (const line of out.split('\n')) {
        if (line.startsWith('\0')) {
          subject = line.slice(1);
          continue;
        }
        const p = line.trim();
        if (!p || subjects.has(p)) continue;
        subjects.set(p, subject);
      }
    }
  } catch {
    return null; // not a git work tree / git not installed
  }
  return subjects;
}

// null = unknown (no git, or the path has no add commit in this history); true/false otherwise.
export function isDocgradAuthored(subject) {
  if (typeof subject !== 'string') return null;
  return DOCGRAD_COMMIT_SUBJECT_RE.test(subject);
}

export const AUTHORSHIP_UNAVAILABLE_NOTE =
  `${NO_GIT}: the commit that added each document cannot be read, so docgrad_authored is null rather than false — the share of candidates coming from documents docgrad itself wrote is unknown for this round`;

// --- docgrad's own version fingerprint (used for history.jsonl's comparability fields) ----------------
//
// rubric_hash is the fingerprint of "the ruler this round used": every edit to rubric.md changes
// the hash, and the report draws a comparability break based on it. The first 8 characters are
// enough to distinguish (collision probability is negligible), and it keeps each history line
// from getting too long.

// corpus_hash is the counterpart fingerprint: rubric_hash answers "which ruler did this round
// use", corpus_hash answers "which files did it measure". Editing docs_dirs / docs_files /
// index_file / entry_files / exclude moves files_total, claims_total, the freshness denominator,
// the orphan/reachability population and the pollution denominator all at once — every score in
// that round becomes incomparable with the round before, while rubric_hash does not change a
// single character. Same shape as rubric_hash (sha256, first 8 hex chars), so report's existing
// comparability-break detection can be reused verbatim.
//
// Normalised before hashing, so cosmetic edits don't fake a break: entries trimmed, trailing
// slashes dropped (`docs/` and `docs` are the same directory), duplicates removed, each list
// sorted. Serialisation is an array of [field, value] pairs in a fixed order — a plain object
// literal would make the digest depend on key insertion order.

const CORPUS_LIST_FIELDS = ['docs_dirs', 'docs_files', 'entry_files', 'exclude'];

function normalizeCorpusEntry(v) {
  return String(v).trim().replace(/\/+$/, '');
}

export function corpusFingerprint(config) {
  const pairs = CORPUS_LIST_FIELDS.map((field) => {
    const raw = Array.isArray(config?.[field]) ? config[field] : [];
    return [field, [...new Set(raw.map(normalizeCorpusEntry).filter(Boolean))].sort()];
  });
  pairs.push(['index_file', config?.index_file ? normalizeCorpusEntry(config.index_file) || null : null]);
  // Not a path, but it selects a different corpus out of the same tree: flipping it moves
  // files_total, the freshness denominator and the pollution denominator. Leaving it out would
  // reproduce the exact blind spot #36 exists to close.
  pairs.push(['exclude_untracked', config?.exclude_untracked === true]);
  return pairs;
}

// No config supplied (an older caller, or a run that never loaded one) -> null, never a crash and
// never a hash of an empty corpus — report must be able to tell "unknown" from "genuinely empty".
export function corpusHash(config) {
  if (!config) return null;
  return createHash('sha256')
    .update(JSON.stringify(corpusFingerprint(config)), 'utf8')
    .digest('hex')
    .slice(0, 8);
}

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function docgradMeta(skillRoot = SKILL_ROOT, config = null) {
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
  return { version, rubric_hash: rubricHash, corpus_hash: corpusHash(config) };
}

// --- Claim identity ------------------------------------------------------------------
//
// `.docgrad/ledger.jsonl` keys a claim on `<path>:<line>`, and docgrad's own improve/loop
// **rewrites documents** — "move content out of the entry file" is literally one of the two
// prescribed economy fixes. Every such move silently repoints a batch of ledger keys at other
// content: the next round re-verifies the wrong line, records a false `fail`, and because
// failures are re-verified without a cap, that batch eats the following round's new-draw budget.
// A harmless tidy-up therefore stops coverage from growing. The tool's core action destroys its
// own state file (#41).
//
// claim_hash is the content-derived key that survives the move, handed to the agent writing the
// ledger so it does not have to invent one. `path` and `line` stay in the output as locating
// aids — they are still how a verifier finds the text to read.
//
// Normalisation is deliberately shallow: runs of whitespace collapsed, ends trimmed. Markdown
// markup is **not** stripped and case is **not** folded, because an edited claim *should* hash
// differently — a rewritten claim genuinely needs re-verification, and treating it as the same
// claim would carry a stale `pass` forward. Moved-but-identical hashing the same is the point;
// edited-but-identical would be the bug.
export function normalizeClaimText(text) {
  return String(text).replace(/\s+/gu, ' ').trim();
}

// sha256, first 12 hex chars — the same shape as rubric_hash/corpus_hash but longer than their 8.
// Those two are a single value per round and only ever compared against the previous round, so
// they have no birthday problem. claim_hash is a **key across a whole population**, and a realistic
// repo carries hundreds to low thousands of claims. At 2,000 claims, 32 bits (8 hex chars) collides
// with probability ~4.7e-4: roughly one repo in two thousand would silently merge two unrelated
// claims into one ledger row — exactly the class of failure this field exists to remove. 48 bits
// puts the same figure at ~7e-9 and still fits comfortably on one JSONL line.
export const CLAIM_HASH_CHARS = 12;

export function claimHash(text) {
  return createHash('sha256')
    .update(normalizeClaimText(text), 'utf8')
    .digest('hex')
    .slice(0, CLAIM_HASH_CHARS);
}

// --- Concrete claim candidates ------------------------------------------------------
//
// A "concrete claim" = a line outside a fence that has code coordinates to check against. Two
// shapes count as coordinates:
//   - path-shaped inline code (`lib/foo.js`, `src/a.ts › parse()`) — extractCodeRefs
//   - API-shaped inline code (`foo()`, `obj.method()`, `a.b`) — extractApiRefs, and **only** when
//     a symbol index built from src_dirs is supplied, so every identifier is existence-checked
// A plain descriptive sentence has no coordinates to extract and shouldn't enter the claim ledger
// in the first place — the rubric's weighted sampling rule for correctness (prefer sampling lines
// with a path/symbol) becomes mechanically reproducible this way, instead of being freely
// re-picked by an LLM each round. Heading lines are excluded: a heading is navigation, not a claim.
//
// options.symbols: the Set from buildSrcSymbolIndex().symbols. Omitted or null (which is what
// buildSrcSymbolIndex returns when src_dirs is unset) makes the API shape inert — no existence
// check is possible, so no candidate is drawn from it.
export function extractClaimLines(text, srcDirs = [], { symbols = null } = {}) {
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
    const pathRefs = extractCodeRefs(line, srcDirs);
    const apiRefs = extractApiRefs(line, symbols);
    const refs = pathRefs.length + apiRefs.length;
    if (!refs) continue;
    const sec = sectionOf(i + 1);
    const text_ = line.trim();
    out.push({
      line: i + 1,
      text: text_,
      // Stable across a move, different after an edit — see claimHash above. path/line remain as
      // locating aids, they are just no longer the identity.
      claim_hash: claimHash(text_),
      refs,
      // The split is disclosed, not just the total: on a library repo `refs_path` is 0 across the
      // board, and a reader needs to see that the population rests entirely on the API matcher.
      refs_path: pathRefs.length,
      refs_api: apiRefs.length,
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
