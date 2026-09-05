import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/basic/', import.meta.url));
const RETRIEVAL_FIXTURE = fileURLToPath(new URL('./fixtures/retrieval/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/inventory.mjs', import.meta.url));

test('inventory: entry_cost 對 symlink 別名去重（同一實體只計一次）', () => {
  // kdan-bpm 的 CLAUDE.md -> AGENTS.md：agent 只載入一份，逐名相加會讓固定成本翻倍。
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
    assert.deepEqual(out.entry_cost.files, ['AGENTS.md', 'CLAUDE.md'], '兩個名稱都要列出');
    assert.equal(out.entry_cost.tokens_est, solo, '只計一次，不是兩倍');
    assert.deepEqual(out.entry_cost.symlink_aliases, [{ path: 'CLAUDE.md', same_file_as: 'AGENTS.md' }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inventory: 清單/型別/entry_cost/pollution', () => {
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

test('inventory: --include 限定範圍（scope 標明、entry 不在範圍則固定成本為 0）', () => {
  const out = JSON.parse(
    execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE, '--include', 'docs/guide.md'], { encoding: 'utf8' })
  );
  assert.deepEqual(out.scope, ['docs/guide.md']);
  assert.deepEqual(out.files.map((f) => f.path), ['docs/guide.md']);
  assert.equal(out.totals.files, 1);
  assert.deepEqual(out.entry_cost.files, []); // CLAUDE.md 不在 scope → 固定成本不可引用
  assert.equal(out.entry_cost.tokens_est, 0);
  assert.deepEqual(out.pollution.excluded_files, []); // 污染面也跟著 scope 收斂
});

test('inventory: 全量時 scope 為 null（既有行為不變）', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE], { encoding: 'utf8' }));
  assert.equal(out.scope, null);
  assert.equal(out.totals.files, 4);
});

test('inventory: 無 .docgrad.yml → exit 1＋stderr 導向 init', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /請先執行 \/docgrad init/);
});

test('inventory: 無 H2 的檔 structure 仍存在但為空', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE], { encoding: 'utf8' }));
  const claude = out.files.find((f) => f.path === 'CLAUDE.md');
  assert.deepEqual(claude.structure.h2, []);
  assert.deepEqual(claude.structure.rules, { count: 0, median_chars: 0, p90_chars: 0, anchored_ratio: 0 });
  assert.equal(out.totals.rules_total, 0);
  assert.equal(out.totals.rules_anchored_ratio, 0);
});

test('inventory: structure.h2 段落級 tokens、rules 中位數/anchored_ratio（retrieval fixture）', () => {
  const out = JSON.parse(
    execFileSync(process.execPath, [SCRIPT, '--root', RETRIEVAL_FIXTURE], { encoding: 'utf8' })
  );
  const guide = out.files.find((f) => f.path === 'docs/guide.md');
  assert.deepEqual(
    guide.structure.h2.map((s) => s.title),
    ['Overview', 'Rules']
  );
  assert.ok(guide.structure.h2.every((s) => s.tokens_est > 0));
  // guide.md 有兩條 **MUST** 規則行：一條帶 `src/foo/bar.ts` 座標、一條沒有 → anchored_ratio 0.5
  assert.equal(guide.structure.rules.count, 2);
  assert.equal(guide.structure.rules.anchored_ratio, 0.5);
  assert.ok(guide.structure.rules.median_chars > 0);
  assert.ok(guide.structure.rules.p90_chars >= guide.structure.rules.median_chars);

  const readme = out.files.find((f) => f.path === 'docs/README.md');
  assert.deepEqual(readme.structure.rules, { count: 0, median_chars: 0, p90_chars: 0, anchored_ratio: 0 });

  assert.equal(out.totals.rules_total, 2);
  assert.equal(out.totals.rules_anchored_ratio, 0.5);
});

test('inventory: rules.pattern 可透過 .docgrad.yml 自訂', () => {
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
