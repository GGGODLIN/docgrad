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
