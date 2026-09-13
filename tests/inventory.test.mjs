import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/basic/', import.meta.url));
const RETRIEVAL_FIXTURE = fileURLToPath(new URL('./fixtures/retrieval/', import.meta.url));
const DOCS_FILES_FIXTURE = fileURLToPath(new URL('./fixtures/docs-files/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/inventory.mjs', import.meta.url));

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

// A working checkout with one tracked and one untracked doc, plus an excluded directory holding
// an untracked draft — the shape that produced the 0.0517 / 0.1066 split on a real repo.
function mixedCheckout() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-untracked-inv-'));
  fs.mkdirSync(path.join(tmp, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'docs', 'a.md'), `# a\n${'x '.repeat(200)}`);
  fs.writeFileSync(path.join(tmp, 'docs', 'plans', 'kept.md'), `# kept\n${'y '.repeat(100)}`);
  fs.writeFileSync(path.join(tmp, '.docgrad.yml'), 'docs_dirs: [docs/]\nexclude: [docs/plans/]\n');
  gitInit(tmp);
  fs.writeFileSync(path.join(tmp, 'docs', 'plans', 'local-wip.md'), `# local draft\n${'z '.repeat(4000)}`);
  return tmp;
}

test('inventory: untracked reports count/tokens/paths, and pollution says the ratio is checkout-bound', () => {
  const tmp = mixedCheckout();
  try {
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' }));
    assert.equal(out.untracked.count, 1);
    assert.deepEqual(out.untracked.files, ['docs/plans/local-wip.md']);
    assert.ok(out.untracked.tokens_est > 0);
    assert.equal(
      out.untracked.tokens_est,
      out.pollution.excluded_files.find((f) => f.path === 'docs/plans/local-wip.md').tokens_est
    );
    assert.match(out.pollution.note, /untracked local file/);
    assert.match(out.pollution.note, /clean checkout/);
    assert.match(out.pollution.note, /exclude_untracked: true/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('inventory: exclude_untracked true shrinks the corpus to the clean checkout and drops the note', () => {
  const tmp = mixedCheckout();
  try {
    const before = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' }));
    fs.appendFileSync(path.join(tmp, '.docgrad.yml'), 'exclude_untracked: true\n');
    const after = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' }));
    assert.ok(
      after.pollution.excluded_tokens < before.pollution.excluded_tokens,
      'the untracked draft no longer inflates the pollution surface'
    );
    assert.deepEqual(after.pollution.excluded_files.map((f) => f.path), ['docs/plans/kept.md']);
    assert.ok(after.pollution.ratio < before.pollution.ratio);
    assert.equal(after.untracked.count, 0);
    assert.equal(after.pollution.note, undefined, 'nothing untracked left to warn about');
    // exclude_untracked selects a different corpus out of the same tree, so #36's break detector
    // must fire: the scores either side of this change are not comparable.
    assert.notEqual(after.docgrad.corpus_hash, before.docgrad.corpus_hash);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('inventory: no git -> untracked is null (not zero) with a note, and the ratio is unchanged', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-nogit-inv-'));
  try {
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(path.join(tmp, 'docs', 'a.md'), '# a\n');
    fs.writeFileSync(path.join(tmp, '.docgrad.yml'), 'docs_dirs: [docs/]\n');
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' }));
    assert.deepEqual(
      { count: out.untracked.count, tokens_est: out.untracked.tokens_est, files: out.untracked.files },
      { count: null, tokens_est: null, files: null }
    );
    assert.match(out.untracked.note, /git is unavailable|not a git working tree/);
    assert.equal(out.pollution.note, undefined, 'no claim is made either way about the ratio');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('inventory: a long untracked list is capped, and the note says so (count/tokens stay exact)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-untracked-cap-'));
  try {
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(path.join(tmp, 'docs', 'a.md'), '# a\n');
    fs.writeFileSync(path.join(tmp, '.docgrad.yml'), 'docs_dirs: [docs/]\n');
    gitInit(tmp);
    for (let i = 0; i < 25; i += 1) fs.writeFileSync(path.join(tmp, 'docs', `d${i}.md`), `# d${i}\n`);
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' }));
    assert.equal(out.untracked.count, 25);
    assert.equal(out.untracked.files.length, 20);
    assert.match(out.untracked.note, /capped: only the first 20 of 25/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('inventory: docgrad carries corpus_hash alongside rubric_hash', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE], { encoding: 'utf8' }));
  assert.match(out.docgrad.corpus_hash, /^[0-9a-f]{8}$/);
  assert.match(out.docgrad.rubric_hash, /^[0-9a-f]{8}$/);
  // #36: a corpus that genuinely differs must produce a different fingerprint, even though the
  // rubric — and therefore rubric_hash — is identical.
  const other = JSON.parse(
    execFileSync(process.execPath, [SCRIPT, '--root', DOCS_FILES_FIXTURE], { encoding: 'utf8' })
  );
  assert.equal(other.docgrad.rubric_hash, out.docgrad.rubric_hash);
  assert.notEqual(other.docgrad.corpus_hash, out.docgrad.corpus_hash);
});

test('inventory: entry_cost dedupes symlink aliases (the same real file only counted once)', () => {
  // kdan-bpm's CLAUDE.md -> AGENTS.md: an agent only loads one copy, summing by name would double the fixed cost.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-symlink-'));
  try {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, '.docgrad.yml'),
      'docs_dirs: [docs/]\nentry_files: [AGENTS.md, CLAUDE.md]\nindex_file: docs/README.md\n');
    fs.writeFileSync(path.join(root, 'docs', 'README.md'), '# idx\n');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# entry\n' + 'x '.repeat(200));
    fs.symlinkSync('AGENTS.md', path.join(root, 'CLAUDE.md'));
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' }));
    const solo = out.files.find((f) => f.path === 'AGENTS.md').tokens_est;
    assert.deepEqual(out.entry_cost.files, ['AGENTS.md', 'CLAUDE.md'], 'both names must be listed');
    assert.equal(out.entry_cost.tokens_est, solo, 'counted once, not doubled');
    assert.deepEqual(out.entry_cost.symlink_aliases, [{ path: 'CLAUDE.md', same_file_as: 'AGENTS.md' }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inventory: listing/type/entry_cost/pollution', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE], { encoding: 'utf8' }));
  assert.equal(out.totals.files, 4);
  assert.equal(out.files.find((f) => f.path === 'CLAUDE.md').type, 'entry');
  assert.equal(out.files.find((f) => f.path === 'docs/README.md').type, 'index');
  assert.equal(out.files.find((f) => f.path === 'docs/guide.md').type, 'doc');
  assert.ok(out.files.every((f) => f.bytes > 0 && f.tokens_est > 0));
  assert.deepEqual(out.entry_cost.files, ['CLAUDE.md']);
  assert.ok(out.entry_cost.tokens_est > 0);
  assert.deepEqual(out.pollution.excluded_files.map((f) => f.path), ['docs/archive/old.md']);
  assert.ok(out.pollution.ratio > 0 && out.pollution.ratio < 1);
});

test('inventory: docs_files are regular documents (type doc), do not inflate the fixed cost', () => {
  // This is the whole reason docs_files exists: listing it as entry_files would also pick up the
  // file, but it would get counted as a tax paid on every single task.
  const out = JSON.parse(
    execFileSync(process.execPath, [SCRIPT, '--root', DOCS_FILES_FIXTURE], { encoding: 'utf8' })
  );
  assert.equal(out.totals.files, 5);
  assert.equal(out.files.find((f) => f.path === 'PRODUCT.md').type, 'doc');
  assert.equal(out.files.find((f) => f.path === 'DESIGN.md').type, 'doc');
  assert.deepEqual(out.entry_cost.files, ['CLAUDE.md']);
  assert.equal(
    out.entry_cost.tokens_est,
    out.files.find((f) => f.path === 'CLAUDE.md').tokens_est,
    'entry_cost may only reflect entry_files; docs_files must not be counted in'
  );
});

test('inventory: --include limits scope (scope is labeled, fixed cost is 0 when entry is outside it)', () => {
  const out = JSON.parse(
    execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE, '--include', 'docs/guide.md'], { encoding: 'utf8' })
  );
  assert.deepEqual(out.scope, ['docs/guide.md']);
  assert.deepEqual(out.files.map((f) => f.path), ['docs/guide.md']);
  assert.equal(out.totals.files, 1);
  assert.deepEqual(out.entry_cost.files, []); // CLAUDE.md is outside scope -> fixed cost cannot be cited
  assert.equal(out.entry_cost.tokens_est, 0);
  assert.deepEqual(out.pollution.excluded_files, []); // pollution surface narrows along with scope
});

test('inventory: scope is null for a full run (unchanged existing behavior)', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE], { encoding: 'utf8' }));
  assert.equal(out.scope, null);
  assert.equal(out.totals.files, 4);
});

test('inventory: no .docgrad.yml -> exit 1 + stderr points at init', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Run \/docgrad init first/);
});

test('inventory: a file with no H2 still gets a structure, just empty', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE], { encoding: 'utf8' }));
  const claude = out.files.find((f) => f.path === 'CLAUDE.md');
  assert.deepEqual(claude.structure.h2, []);
  assert.deepEqual(claude.structure.rules, { count: 0, median_chars: 0, p90_chars: 0, anchored_ratio: 0 });
  assert.equal(out.totals.rules_total, 0);
  assert.equal(out.totals.rules_anchored_ratio, 0);
});

test('inventory: structure.h2 per-section tokens, rules median/anchored_ratio (retrieval fixture)', () => {
  const out = JSON.parse(
    execFileSync(process.execPath, [SCRIPT, '--root', RETRIEVAL_FIXTURE], { encoding: 'utf8' })
  );
  const guide = out.files.find((f) => f.path === 'docs/guide.md');
  assert.deepEqual(
    guide.structure.h2.map((s) => s.title),
    ['Overview', 'Rules']
  );
  assert.ok(guide.structure.h2.every((s) => s.tokens_est > 0));
  // guide.md has two **MUST** rule lines: one has a `src/foo/bar.ts` anchor, one doesn't -> anchored_ratio 0.5
  assert.equal(guide.structure.rules.count, 2);
  assert.equal(guide.structure.rules.anchored_ratio, 0.5);
  assert.ok(guide.structure.rules.median_chars > 0);
  assert.ok(guide.structure.rules.p90_chars >= guide.structure.rules.median_chars);

  const readme = out.files.find((f) => f.path === 'docs/README.md');
  assert.deepEqual(readme.structure.rules, { count: 0, median_chars: 0, p90_chars: 0, anchored_ratio: 0 });

  assert.equal(out.totals.rules_total, 2);
  assert.equal(out.totals.rules_anchored_ratio, 0.5);
});

test('inventory: rules.pattern can be customized via .docgrad.yml', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-rules-'));
  try {
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(
      path.join(tmp, 'docs', 'a.md'),
      '# A\n\n- **MUST**: 用預設字串不該被抓到（自訂 pattern 換了）。\n- TODO: 這條才算規則。\n'
    );
    fs.writeFileSync(
      path.join(tmp, '.docgrad.yml'),
      'docs_dirs: [docs/]\nentry_files: []\nfreshness:\n  convention: none\nrules:\n  pattern: "TODO"\n'
    );
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' }));
    assert.equal(out.files[0].structure.rules.count, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// #41: the ledger keys a claim on `<path>:<line>`, and docgrad's own convergence loop moves
// content between documents. claim_hash is the content-derived key handed to the agent writing
// the ledger, so a move no longer silently repoints a batch of rows at unrelated content.
test('inventory: claim_candidates carry a content-derived claim_hash; path/line stay as locating aids', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-claimhash-'));
  try {
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.mkdirSync(path.join(tmp, 'src'));
    fs.writeFileSync(path.join(tmp, 'src', 'balance.ts'), 'export function settle() {}\n');
    const claim = 'Settlement is handled by `src/balance.ts`.';
    // the same sentence, in another file at another line — the "moved" case
    fs.writeFileSync(path.join(tmp, 'docs', 'a.md'), `# A\n\n${claim}\n`);
    fs.writeFileSync(path.join(tmp, 'docs', 'b.md'), `# B\n\nfiller\n\nfiller\n\n${claim}\n`);
    // one token different — the "edited" case, which must NOT key the same
    fs.writeFileSync(path.join(tmp, 'docs', 'c.md'), '# C\n\nSettlement is handled by `src/ledger.ts`.\n');
    fs.writeFileSync(path.join(tmp, '.docgrad.yml'), 'docs_dirs: [docs/]\nsrc_dirs: [src/]\n');
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' }));
    const byPath = Object.fromEntries(out.claim_candidates.map((c) => [c.path, c]));
    assert.equal(byPath['docs/a.md'].line, 3);
    assert.equal(byPath['docs/b.md'].line, 7);
    assert.match(byPath['docs/a.md'].claim_hash, /^[0-9a-f]{12}$/);
    assert.equal(
      byPath['docs/a.md'].claim_hash,
      byPath['docs/b.md'].claim_hash,
      'moved-but-identical must key the same — that is the whole point'
    );
    assert.notEqual(
      byPath['docs/c.md'].claim_hash,
      byPath['docs/a.md'].claim_hash,
      'an edited claim genuinely needs re-verification, so it must key differently'
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- #40: a library repo has a claim population, and the report says where it came from --------

// A library repo the way tj/commander.js is written: documentation describes an API, and not one
// inline code span is path-shaped. Baseline claims_total on that repo was 0.
function libraryRepo({ withSrcDirs = true, git = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-library-'));
  fs.mkdirSync(path.join(tmp, 'docs'));
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.writeFileSync(
    path.join(tmp, 'src', 'command.js'),
    'class Command {\n  option() {}\n  opts() {}\n}\nconst program = new Command();\n'
  );
  fs.writeFileSync(
    path.join(tmp, 'docs', 'options.md'),
    [
      '# Options',
      '',
      'Declare an option with `.option()`.',
      'Read the parsed values with `program.opts()`.',
      'The `.mangle()` helper does not exist in this library.',
      'A `sandwich` is not an API.',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(tmp, '.docgrad.yml'),
    `docs_dirs: [docs/]\n${withSrcDirs ? 'src_dirs: [src/]\n' : ''}`
  );
  if (git) gitInit(tmp);
  return tmp;
}

test('inventory: a library repo gets a claim population from API-shaped inline code, guarded by src_dirs (#40)', () => {
  const tmp = libraryRepo();
  try {
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' }));
    assert.equal(out.totals.claims_total, 2, 'only the two lines whose symbols exist under src_dirs');
    assert.equal(out.totals.claims_api_only, 2, 'nothing path-shaped in this corpus at all');
    assert.deepEqual(out.claim_candidates.map((c) => c.line), [3, 4]);
    assert.ok(out.claim_candidates.every((c) => c.refs_path === 0 && c.refs_api === 1));
    assert.equal(out.claim_population.api_matching, 'enabled');
    assert.ok(out.claim_population.src_symbols > 0);
    assert.equal(out.claim_population.src_files_scanned, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('inventory: src_dirs unset makes the API matcher inert, and says so out loud (#40)', () => {
  const tmp = libraryRepo({ withSrcDirs: false });
  try {
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' }));
    assert.equal(out.totals.claims_total, 0, 'no src_dirs, no existence check, no new candidates');
    assert.equal(out.totals.claims_api_only, 0);
    assert.equal(out.claim_population.api_matching, 'disabled');
    assert.equal(out.claim_population.src_symbols, null);
    assert.ok(
      out.claim_population.notes.some((n) => n.includes('src_dirs is unset')),
      'the degradation must be visible, not silent'
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('inventory: candidates disclose whether docgrad itself wrote the document they came from (#40)', () => {
  const tmp = libraryRepo({ git: true });
  try {
    // a second document, added by a commit carrying docgrad's own subject prefix
    fs.writeFileSync(path.join(tmp, 'docs', 'internals.md'), '# Internals\n\nUse `program.opts()` internally.\n');
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
    };
    execFileSync('git', ['add', '-A'], { cwd: tmp, env });
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'docs(docgrad): round 3 — correctness'], { cwd: tmp, env });

    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' }));
    const byPath = Object.fromEntries(out.claim_candidates.map((c) => [c.path, c]));
    assert.equal(byPath['docs/internals.md'].docgrad_authored, true);
    assert.equal(byPath['docs/options.md'].docgrad_authored, false);
    assert.equal(out.claim_population.authorship, 'git');
    assert.equal(out.totals.claims_total, 3);
    assert.equal(out.totals.claims_docgrad_authored, 1);
    assert.equal(out.totals.claims_docgrad_authored_ratio, 0.3333);
    assert.ok(
      out.claim_population.notes.some((n) => n.includes("docgrad itself wrote")),
      'the share must be stated, not left for the reader to compute'
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('inventory: without git, docgrad_authored is null rather than false, with a note (#40)', () => {
  const tmp = libraryRepo();
  try {
    const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' }));
    assert.equal(out.claim_population.authorship, 'unavailable');
    assert.ok(out.claim_candidates.every((c) => c.docgrad_authored === null));
    assert.ok(out.files.every((f) => f.docgrad_authored === null));
    assert.equal(out.totals.claims_docgrad_authored, null, '"we cannot tell" is not "zero"');
    assert.equal(out.totals.claims_docgrad_authored_ratio, null);
    assert.ok(out.claim_population.notes.some((n) => n.includes('docgrad_authored is null rather than false')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
