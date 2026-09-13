import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseYamlSubset, loadConfig, resolveRoot, parseArgs, matchesScope, collectFiles, estimateTokens, githubSlug, extractHeadings, extractLinks, extractClaimedDate, parseFreshnessConventions, extractCodeRefs, docgradMeta, corpusHash, gitTrackedFiles, extractClaimLines, rankClaimCandidates } from '../scripts/lib.mjs';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/basic/', import.meta.url));
const DOCS_FILES_FIXTURE = fileURLToPath(new URL('./fixtures/docs-files/', import.meta.url));

// A throwaway git work tree: files already on disk get committed, anything written afterwards is
// untracked. Isolated from the developer's own git config/hooks so CI and laptops behave alike.
function gitInit(tmp) {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
  };
  execFileSync('git', ['init', '-q'], { cwd: tmp, env });
  execFileSync('git', ['add', '-A'], { cwd: tmp, env });
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture'], { cwd: tmp, env });
}

test('parseYamlSubset: parse a full .docgrad.yml template', () => {
  const doc = `
# comment line
docs_dirs: [docs/]
entry_files: [CLAUDE.md, AGENTS.md]
index_file: docs/README.md
exclude: []
freshness:
  convention: frontmatter
  field: last_updated
targets:
  completeness: 4
  correctness: 3
correctness_sample: 8
scenario: "Add a typical new feature to core"  # trailing comment
language: zh-TW
`;
  const got = parseYamlSubset(doc);
  assert.deepEqual(got.docs_dirs, ['docs/']);
  assert.deepEqual(got.entry_files, ['CLAUDE.md', 'AGENTS.md']);
  assert.equal(got.index_file, 'docs/README.md');
  assert.deepEqual(got.exclude, []);
  assert.deepEqual(got.freshness, { convention: 'frontmatter', field: 'last_updated' });
  assert.equal(got.targets.completeness, 4);
  assert.equal(got.targets.correctness, 3);
  assert.equal(got.correctness_sample, 8);
  assert.equal(got.scenario, 'Add a typical new feature to core');
  assert.equal(got.language, 'zh-TW');
});

test('parseYamlSubset: block list, and # and : inside quotes', () => {
  const got = parseYamlSubset(
    'exclude:\n  - docs/archive/\n  - "docs/#wip/"\nfreshness:\n  field: "Last updated:"\n'
  );
  assert.deepEqual(got.exclude, ['docs/archive/', 'docs/#wip/']);
  assert.equal(got.freshness.field, 'Last updated:');
});

test('parseYamlSubset: illegal indentation throws', () => {
  assert.throws(() => parseYamlSubset('  orphan_indent: 1\n'), /indentation/);
});

test('loadConfig: missing config file throws an error pointing at init', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-'));
  try {
    assert.throws(() => loadConfig(tmp), /Run \/docgrad init first/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadConfig: throws when convention requires field but field is unset', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-'));
  try {
    fs.writeFileSync(path.join(tmp, '.docgrad.yml'), 'freshness:\n  convention: heading-line\n');
    assert.throws(() => loadConfig(tmp), /freshness\.field/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadConfig: unset fields get their defaults, nested maps deep-merge', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-'));
  try {
    fs.writeFileSync(
      path.join(tmp, '.docgrad.yml'),
      'docs_dirs: [documentation/]\nfreshness:\n  convention: frontmatter\n  field: last_updated\n'
    );
    const cfg = loadConfig(tmp);
    assert.deepEqual(cfg.docs_dirs, ['documentation/']);
    assert.deepEqual(cfg.entry_files, []);
    assert.deepEqual(cfg.docs_files, []); // v1.4.0 new field: must default to an empty array even when an old config omits it (otherwise collectFiles crashes)
    assert.equal(cfg.index_file, null);
    assert.equal(cfg.targets.completeness, 4);
    assert.equal(cfg.targets.economy, 4); // v1.0.0's sixth dimension: an old config that omits it must still get the default target
    assert.deepEqual(cfg.economy.entry_cost_tiers, [20000, 10000, 5000, 3000]);
    assert.equal(cfg.economy.pollution_max, 0.1);
    assert.equal(cfg.freshness.convention, 'frontmatter');
    assert.equal(cfg.freshness.stale_after_days, 60); // the default isn't swallowed by the freshness override
    assert.equal(cfg.correctness_sample, 8);
    assert.equal(cfg.language, 'zh-TW');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- #36: corpus_hash -------------------------------------------------------------------------

test('corpusHash: cosmetic differences that mean the same corpus hash the same', () => {
  const base = {
    docs_dirs: ['docs/', 'guides/'],
    docs_files: ['PRODUCT.md', 'DESIGN.md'],
    entry_files: ['CLAUDE.md'],
    exclude: ['docs/archive/'],
    index_file: 'docs/README.md',
  };
  const cosmetic = {
    // reordered, trailing slashes flipped, whitespace, a duplicate entry
    docs_dirs: ['guides', ' docs/ '],
    docs_files: ['DESIGN.md', 'PRODUCT.md', 'PRODUCT.md'],
    entry_files: ['CLAUDE.md'],
    exclude: ['docs/archive'],
    index_file: ' docs/README.md',
  };
  assert.equal(corpusHash(cosmetic), corpusHash(base));
  assert.match(corpusHash(base), /^[0-9a-f]{8}$/, 'same shape as rubric_hash');
});

test('corpusHash: fields outside the corpus definition do not move it', () => {
  const base = { docs_dirs: ['docs/'], docs_files: [], entry_files: [], exclude: [], index_file: null };
  assert.equal(
    corpusHash({ ...base, src_dirs: ['src/'], scenarios: ['src/a.ts'], correctness_sample: 20, targets: { economy: 5 } }),
    corpusHash(base),
    'a corpus fingerprint must not react to rubric/target/measurement settings'
  );
});

test('corpusHash: every corpus-defining field genuinely changes it', () => {
  const base = {
    docs_dirs: ['docs/'], docs_files: [], entry_files: ['CLAUDE.md'], exclude: [], index_file: 'docs/README.md',
  };
  const before = corpusHash(base);
  // the v1.4.0 case from #36: adding docs_files moved files_total 46->48 while rubric_hash stood still
  assert.notEqual(corpusHash({ ...base, docs_files: ['PRODUCT.md'] }), before, 'docs_files');
  assert.notEqual(corpusHash({ ...base, docs_dirs: ['docs/', 'guides/'] }), before, 'docs_dirs');
  assert.notEqual(corpusHash({ ...base, entry_files: ['CLAUDE.md', 'AGENTS.md'] }), before, 'entry_files');
  assert.notEqual(corpusHash({ ...base, exclude: ['docs/archive/'] }), before, 'exclude');
  assert.notEqual(corpusHash({ ...base, index_file: 'README.md' }), before, 'index_file');
  assert.notEqual(corpusHash({ ...base, index_file: null }), before, 'index_file unset');
});

test('corpusHash: no config -> null (never a hash of an empty corpus)', () => {
  assert.equal(corpusHash(null), null);
  assert.equal(corpusHash(undefined), null);
  assert.notEqual(corpusHash({ docs_dirs: [] }), null, 'a genuinely empty config still hashes');
});

// --- #35: untracked files ---------------------------------------------------------------------

test('gitTrackedFiles: returns the tracked set inside a work tree, null outside one', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-tracked-'));
  try {
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(path.join(tmp, 'docs', 'a.md'), '# a\n');
    assert.equal(gitTrackedFiles(tmp), null, 'not a git work tree -> null, not an empty set');
    gitInit(tmp);
    fs.writeFileSync(path.join(tmp, 'docs', 'draft.md'), '# draft\n');
    const tracked = gitTrackedFiles(tmp);
    assert.ok(tracked.has('docs/a.md'));
    assert.ok(!tracked.has('docs/draft.md'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collectFiles: exclude_untracked true drops untracked files, including .gitignore\'d ones', () => {
  // The measured case: the file that moved pollution.ratio 0.0517 -> 0.1066 was untracked *and*
  // ignored, so `git ls-files --others --exclude-standard` would have filtered it back out.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-untracked-'));
  try {
    fs.mkdirSync(path.join(tmp, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'docs', 'a.md'), '# a\n');
    fs.writeFileSync(path.join(tmp, 'docs', 'plans', 'kept.md'), '# kept\n');
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'docs/plans/local-*\n');
    fs.writeFileSync(path.join(tmp, '.docgrad.yml'), 'docs_dirs: [docs/]\nexclude: [docs/plans/]\n');
    gitInit(tmp);
    fs.writeFileSync(path.join(tmp, 'docs', 'draft.md'), '# untracked draft\n');
    fs.writeFileSync(path.join(tmp, 'docs', 'plans', 'local-wip.md'), '# ignored + untracked\n');

    const off = collectFiles(tmp, loadConfig(tmp));
    assert.deepEqual(off.included, ['docs/a.md', 'docs/draft.md'], 'default: untracked files still counted');
    assert.deepEqual(off.excluded, ['docs/plans/kept.md', 'docs/plans/local-wip.md']);

    fs.appendFileSync(path.join(tmp, '.docgrad.yml'), 'exclude_untracked: true\n');
    const on = collectFiles(tmp, loadConfig(tmp));
    assert.deepEqual(on.included, ['docs/a.md'], 'opt-in: corpus matches a clean checkout');
    assert.deepEqual(on.excluded, ['docs/plans/kept.md'], 'the pollution denominator shrinks too');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collectFiles: exclude_untracked true without git throws instead of silently doing nothing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-untracked-nogit-'));
  try {
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(path.join(tmp, 'docs', 'a.md'), '# a\n');
    fs.writeFileSync(path.join(tmp, '.docgrad.yml'), 'docs_dirs: [docs/]\nexclude_untracked: true\n');
    assert.throws(() => collectFiles(tmp, loadConfig(tmp)), /exclude_untracked: true.*git/s);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveRoot: --root wins, otherwise cwd', () => {
  assert.equal(resolveRoot(['--root', '/tmp/x']), path.resolve('/tmp/x'));
  assert.equal(resolveRoot([]), process.cwd());
});

test('parseArgs: --root/--config/--include (repeatable + comma-separated)', () => {
  const a = parseArgs(['--root', '/tmp/x', '--include', 'docs/infra/', '--include', 'docs/a/**,docs/b.md']);
  assert.equal(a.root, path.resolve('/tmp/x'));
  assert.equal(a.configFile, path.join(path.resolve('/tmp/x'), '.docgrad.yml'));
  assert.deepEqual(a.include, ['docs/infra/', 'docs/a/**', 'docs/b.md']);
});

test('parseArgs: --config external; defaults to <root>/.docgrad.yml with no flags, include is empty', () => {
  assert.equal(parseArgs(['--config', '/tmp/cfg.yml']).configFile, path.resolve('/tmp/cfg.yml'));
  const bare = parseArgs([]);
  assert.equal(bare.configFile, path.join(process.cwd(), '.docgrad.yml'));
  assert.deepEqual(bare.include, []);
});

test('parseArgs: missing value and unknown argument throw (not swallowed silently)', () => {
  assert.throws(() => parseArgs(['--include']), /--include requires a value/);
  assert.throws(() => parseArgs(['--root', '--include', 'x']), /--root requires a value/);
  assert.throws(() => parseArgs(['--dim', 'freshness']), /Unknown argument/);
});

test('matchesScope: empty = full scope; directory prefix aligns with path segments; * does not cross levels, ** does', () => {
  assert.equal(matchesScope('docs/a/b.md', []), true);
  assert.equal(matchesScope('docs/infra/x.md', ['docs/infra']), true);
  assert.equal(matchesScope('docs/infra/x.md', ['docs/infra/']), true);
  assert.equal(matchesScope('docs/infrastructure/x.md', ['docs/infra']), false);
  assert.equal(matchesScope('docs/a.md', ['./docs/a.md']), true);
  assert.equal(matchesScope('docs/a.md', ['docs/*.md']), true);
  assert.equal(matchesScope('docs/a/b.md', ['docs/*.md']), false);
  assert.equal(matchesScope('docs/a/b.md', ['docs/**/*.md']), true);
  assert.equal(matchesScope('docs/b.md', ['docs/**/*.md']), true); // ** can match zero levels
  assert.equal(matchesScope('docs/ab.md', ['docs/?b.md']), true);
  assert.equal(matchesScope('docs/aab.md', ['docs/?b.md']), false);
});

test('loadConfig: --config points at a config file outside root (the doc source itself takes no written file)', () => {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-cfg-'));
  const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-src-'));
  try {
    const cfgFile = path.join(cfgDir, 'exported.yml');
    fs.writeFileSync(cfgFile, 'docs_dirs: [pages/]\nentry_files: []\n');
    const cfg = loadConfig(docsRoot, cfgFile); // docsRoot has no .docgrad.yml of its own
    assert.deepEqual(cfg.docs_dirs, ['pages/']);
    assert.throws(() => loadConfig(docsRoot), /Run \/docgrad init first/);
  } finally {
    fs.rmSync(cfgDir, { recursive: true, force: true });
    fs.rmSync(docsRoot, { recursive: true, force: true });
  }
});

test('collectFiles: excludes exclude, includes entry_files, paths sorted', () => {
  const cfg = loadConfig(FIXTURE);
  const { included, excluded } = collectFiles(FIXTURE, cfg);
  assert.deepEqual(included, ['CLAUDE.md', 'docs/README.md', 'docs/guide.md', 'docs/orphan.md']);
  assert.deepEqual(excluded, ['docs/archive/old.md']);
});

test('collectFiles: include narrows to scope; exclude still wins over scope', () => {
  const cfg = loadConfig(FIXTURE);
  const { included, excluded } = collectFiles(FIXTURE, cfg, { include: ['docs/guide.md', 'docs/archive/**'] });
  assert.deepEqual(included, ['docs/guide.md']);
  assert.deepEqual(excluded, ['docs/archive/old.md']); // inside scope, but still blocked by exclude
  assert.deepEqual(collectFiles(FIXTURE, cfg, { include: ['docs/*.md'] }).included, [
    'docs/README.md', 'docs/guide.md', 'docs/orphan.md',
  ]);
});

test('collectFiles: docs_files pulls a single file outside docs_dirs into the corpus', () => {
  // This is docs_files' guard rail: if the field were removed, PRODUCT.md/DESIGN.md wouldn't be
  // picked up and this test would go red immediately.
  const cfg = loadConfig(DOCS_FILES_FIXTURE);
  const { included } = collectFiles(DOCS_FILES_FIXTURE, cfg);
  assert.deepEqual(included, [
    'CLAUDE.md', 'DESIGN.md', 'PRODUCT.md', 'docs/README.md', 'docs/guide.md',
  ]);
});

test('collectFiles: docs_files dedupes, silently skips missing files, exclude still wins', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-docsfiles-'));
  try {
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(path.join(tmp, 'docs', 'a.md'), '# a\n');
    fs.writeFileSync(path.join(tmp, 'ROOT.md'), '# root\n');
    fs.writeFileSync(path.join(tmp, 'DROPPED.md'), '# dropped\n');
    fs.writeFileSync(
      path.join(tmp, '.docgrad.yml'),
      'docs_dirs: [docs/]\ndocs_files: [docs/a.md, ROOT.md, DROPPED.md, GONE.md]\n' +
        'exclude: [DROPPED.md]\nfreshness:\n  convention: none\n'
    );
    const { included, excluded } = collectFiles(tmp, loadConfig(tmp));
    // docs/a.md is already picked up by docs_dirs -> not duplicated; GONE.md doesn't exist -> silently skipped (same as entry_files)
    assert.deepEqual(included, ['ROOT.md', 'docs/a.md']);
    assert.deepEqual(excluded, ['DROPPED.md']); // listing it in docs_files doesn't block exclude
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collectFiles: docs_files pointing at a directory -> throws explicitly (instead of letting inventory blow up with EISDIR)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-docsfiles-dir-'));
  try {
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(path.join(tmp, 'docs', 'a.md'), '# a\n');
    fs.writeFileSync(
      path.join(tmp, '.docgrad.yml'),
      'docs_dirs: [docs/]\ndocs_files: [docs/]\nfreshness:\n  convention: none\n'
    );
    assert.throws(() => collectFiles(tmp, loadConfig(tmp)), /docs_files may only list a single file.*docs_dirs/s);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('estimateTokens: ASCII is 1 token per 4 characters', () => {
  assert.equal(estimateTokens('a'.repeat(40)), 10);
});

test('estimateTokens: CJK is 1.1 tokens per character', () => {
  assert.equal(estimateTokens('中文字'), 3); // round(3.3)
  assert.equal(estimateTokens('中'.repeat(10)), 11);
});

test('githubSlug: lowercase, strip punctuation, spaces to dashes, CJK preserved', () => {
  assert.equal(githubSlug('Docs index'), 'docs-index');
  assert.equal(githubSlug('中文標題'), '中文標題');
  assert.equal(githubSlug('API v2.0 (beta)'), 'api-v20-beta');
});

test('githubSlug: each individual space becomes its own dash (adjacent spaces left by stripped punctuation give a double dash)', () => {
  // GitHub's actual behavior: strip punctuation first, then turn each space into a dash, so
  // `a / b` -> `a--b`. The old implementation collapsed with \s+ into a single dash.
  assert.equal(githubSlug('狀態圖例 (status / sot_level legend)'), '狀態圖例-status--sot_level-legend');
  assert.equal(githubSlug('5. 業務動作 → 呼叫對應'), '5-業務動作--呼叫對應');
  assert.equal(githubSlug('a  b'), 'a--b');
});

test('extractHeadings: a word-internal underscore is literal; only an emphasis underscore is stripped', () => {
  assert.ok(extractHeadings('## snake_case_name here\n').has('snake_case_name-here'));
  assert.ok(extractHeadings('## _italic_ title\n').has('italic-title'));
  assert.ok(extractHeadings('## __bold__ x\n').has('bold-x'));
  assert.ok(extractHeadings('## `code` span\n').has('code-span'));
  assert.ok(extractHeadings('## 狀態圖例 (status / sot_level legend)\n').has('狀態圖例-status--sot_level-legend'));
});

test('extractHeadings: explicit anchors <a id>/<a name> are also indexed into the slug set', () => {
  const slugs = extractHeadings('# T\n\n<a id="canonical-contracts"></a>\n## 內容\n');
  assert.ok(slugs.has('canonical-contracts'), '<a id> should be indexed');
  assert.ok(slugs.has('t') && slugs.has('內容'), 'a normal heading is unaffected');
  assert.ok(extractHeadings("<a name='legacy-anchor'></a>\n").has('legacy-anchor'), 'single-quoted name= is also recognized');
  assert.ok(extractHeadings('<a class="x" id="with-attrs"></a>\n').has('with-attrs'), 'other attributes before it are also fine');
});

test('extractHeadings: repeated headings get a numeric suffix', () => {
  const slugs = extractHeadings('# A\n## Setup\n## Setup\n');
  assert.ok(slugs.has('a') && slugs.has('setup') && slugs.has('setup-1'));
});

test('extractLinks: captures inline links, skips code fences', () => {
  const links = extractLinks('[a](x.md)\n```\n[no](skip.md)\n```\n![img](p.png)\n');
  assert.deepEqual(links, [
    { target: 'x.md', line: 1 },
    { target: 'p.png', line: 5 },
  ]);
});

test('extractClaimedDate: frontmatter / heading-line / none', () => {
  const fm = '---\ntitle: x\nlast_updated: 2026-07-01\n---\n# T\n';
  assert.equal(extractClaimedDate(fm, { convention: 'frontmatter', field: 'last_updated' }), '2026-07-01');
  assert.equal(extractClaimedDate('# T\n', { convention: 'frontmatter', field: 'last_updated' }), null);
  const hl = '# T\n\n> Last updated: 2026-06-15\n';
  assert.equal(extractClaimedDate(hl, { convention: 'heading-line', field: 'Last updated:' }), '2026-06-15');
  assert.equal(extractClaimedDate(hl, { convention: 'none', field: null }), null);
});

test('parseFreshnessConventions: single value / comma / plus separated / empty -> none', () => {
  assert.deepEqual(parseFreshnessConventions('frontmatter'), ['frontmatter']);
  assert.deepEqual(parseFreshnessConventions('frontmatter,heading-line'), ['frontmatter', 'heading-line']);
  assert.deepEqual(parseFreshnessConventions('frontmatter+heading-line'), ['frontmatter', 'heading-line']);
  assert.deepEqual(parseFreshnessConventions('frontmatter , heading-line'), ['frontmatter', 'heading-line']);
  assert.deepEqual(parseFreshnessConventions(null), ['none']);
  assert.deepEqual(parseFreshnessConventions('none'), ['none']);
});

test('extractClaimedDate: multiple values tried in order, first extracted wins', () => {
  const fm = '---\nlast_updated: 2026-07-01\n---\n# T\n';
  const hl = '# T\n\n> Last updated: 2026-06-15\n';
  const freshness = { convention: 'frontmatter,heading-line', field: 'last_updated', heading_field: 'Last updated:' };
  assert.equal(extractClaimedDate(fm, freshness), '2026-07-01'); // only frontmatter matches
  assert.equal(extractClaimedDate(hl, freshness), '2026-06-15'); // frontmatter finds nothing -> falls back to heading-line
  assert.equal(extractClaimedDate('# T\n', freshness), null); // neither matches
});

test('extractClaimedDate: heading-line falls back to field as heading_field when only field is set (compatible with old configs)', () => {
  const hl = '# T\n\n> Last updated: 2026-06-15\n';
  assert.equal(
    extractClaimedDate(hl, { convention: 'heading-line', field: 'Last updated:', heading_field: null }),
    '2026-06-15'
  );
});

test('extractCodeRefs: a path inside a single backtick span, starting with an srcDirs prefix', () => {
  const text = '參考 `apps/api/src/contract/contract-approval.service.ts` 的實作。';
  const refs = extractCodeRefs(text, ['apps/api/src']);
  assert.deepEqual(refs, [
    { path: 'apps/api/src/contract/contract-approval.service.ts', symbol: null, basenameOnly: false },
  ]);
});

test('extractCodeRefs: the `path › symbol` single-backtick form (how-to.md convention)', () => {
  const text = '見 `scripts/lib.mjs › DEFAULTS.targets` 與 `scripts/lib.mjs › parseYamlSubset()`。';
  const refs = extractCodeRefs(text, ['scripts']);
  assert.deepEqual(refs, [
    { path: 'scripts/lib.mjs', symbol: 'DEFAULTS.targets', basenameOnly: false },
    { path: 'scripts/lib.mjs', symbol: 'parseYamlSubset()', basenameOnly: false },
  ]);
});

test('extractCodeRefs: a bare filename (no path prefix) matched by basename, including two backtick spans joined by ›', () => {
  const text = '寫入點＝`contract-approval.service.ts` submit；另見 `contract-approval.service.ts` › `approve()`。';
  const refs = extractCodeRefs(text, ['apps/api/src']);
  assert.deepEqual(refs, [
    { path: 'contract-approval.service.ts', symbol: null, basenameOnly: true },
    { path: 'contract-approval.service.ts', symbol: 'approve()', basenameOnly: true },
  ]);
});

test('extractCodeRefs: a bare directory (no filename) also counts as a path anchor, and contractx does not falsely match the contract prefix', () => {
  const text = '`apps/api/src/timesheet` 整個模組；`apps/api/src/contractx/foo.ts` 不該被當成 contract 前綴命中。';
  const refs = extractCodeRefs(text, ['apps/api/src/timesheet', 'apps/api/src/contract']);
  assert.deepEqual(refs.map((r) => r.path), ['apps/api/src/timesheet']);
});

test('extractCodeRefs: skips backticks inside a code fence, skips non-path-shaped inline code', () => {
  const text = '```\n`apps/api/src/skip.ts`\n```\n一般 `npm install` 不是路徑。';
  const refs = extractCodeRefs(text, ['apps/api/src']);
  assert.deepEqual(refs, []);
});

test('docgradMeta: corpus_hash is null without a config, and present with one (backward-compatible signature)', () => {
  assert.equal(docgradMeta().corpus_hash, null, 'an old one-argument caller must not crash');
  const cfg = loadConfig(FIXTURE);
  assert.equal(docgradMeta(undefined, cfg).corpus_hash, corpusHash(cfg));
  assert.match(docgradMeta(undefined, cfg).corpus_hash, /^[0-9a-f]{8}$/);
});

test('docgradMeta: returns version and rubric fingerprint; the hash changes when rubric changes', () => {
  const meta = docgradMeta();
  assert.match(meta.version, /^\d+\.\d+\.\d+$/);
  assert.match(meta.rubric_hash, /^[0-9a-f]{8}$/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-meta-'));
  try {
    fs.mkdirSync(path.join(tmp, '.claude-plugin'));
    fs.mkdirSync(path.join(tmp, 'reference'));
    fs.writeFileSync(path.join(tmp, '.claude-plugin/plugin.json'), '{"version":"9.9.9"}');
    fs.writeFileSync(path.join(tmp, 'reference/rubric.md'), '★4 anchor A');
    const before = docgradMeta(tmp);
    assert.equal(before.version, '9.9.9');
    fs.writeFileSync(path.join(tmp, 'reference/rubric.md'), '★4 anchor B');
    assert.notEqual(docgradMeta(tmp).rubric_hash, before.rubric_hash);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('docgradMeta: returns null instead of throwing when files cannot be read', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-meta-'));
  try {
    assert.deepEqual(docgradMeta(tmp), { version: null, rubric_hash: null, corpus_hash: null });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractClaimLines: only keeps non-heading lines outside a fence that have code coordinates', () => {
  const text = [
    '# 標題含 `src/a.ts` 但不算宣稱',
    '',
    '路由定義在 `src/router.ts`。',
    '這是一段沒有座標的純敘述。',
    '```',
    'fence 內的 `src/ignored.ts` 不算',
    '```',
    '- `src/lib.ts › parse()` 負責解析',
  ].join('\n');
  const claims = extractClaimLines(text, ['src/']);
  assert.deepEqual(claims.map((c) => c.line), [3, 8]);
  assert.equal(claims[0].refs, 1);
});

test('extractClaimLines: returns the section range it belongs to, so verification covers the sentence next to the anchor', () => {
  // The oikos balance sign was written in the sentence right after the anchor line — checking
  // only the anchor line would have missed the whole thing.
  const text = [
    '# 結算設計',
    '',
    '結算由 `src/balance.ts › settle()` 負責。',
    '',
    '回傳正數代表 memberA 欠 memberB。',
    '',
    '## 其他',
    '',
    '無關內容。',
  ].join('\n');
  const [claim] = extractClaimLines(text, ['src/']);
  assert.equal(claim.line, 3);
  assert.equal(claim.section, '結算設計');
  const [start, end] = claim.section_lines;
  assert.ok(start <= 5 && end >= 5, `the neighboring sentence on line 5 must fall inside section range [${start}, ${end}]`);
  assert.ok(end < 7, 'the section range must not cross the next heading');
});

test('rankClaimCandidates: more refs comes first, ties broken by path then line (stable, reproducible)', () => {
  const ranked = rankClaimCandidates([
    { path: 'b.md', claims: [{ line: 2, text: 'x', refs: 1 }] },
    { path: 'a.md', claims: [{ line: 9, text: 'y', refs: 1 }, { line: 1, text: 'z', refs: 3 }] },
  ]);
  assert.deepEqual(
    ranked.map((c) => `${c.path}:${c.line}`),
    ['a.md:1', 'a.md:9', 'b.md:2']
  );
});
