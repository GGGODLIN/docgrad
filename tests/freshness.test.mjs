import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/basic/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/freshness.mjs', import.meta.url));

function makeGitFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-git-'));
  fs.cpSync(FIXTURE, tmp, { recursive: true });
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@example.com',
    GIT_AUTHOR_DATE: '2026-06-15T12:00:00', GIT_COMMITTER_DATE: '2026-06-15T12:00:00',
  };
  execFileSync('git', ['init', '-q'], { cwd: tmp, env });
  execFileSync('git', ['add', '-A'], { cwd: tmp, env });
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture'], { cwd: tmp, env });
  return tmp;
}

test('freshness: coverage/stale/mismatch（DOCGRAD_TODAY 固定今天）', () => {
  const tmp = makeGitFixture();
  const r = spawnSync(process.execPath, [SCRIPT, '--root', tmp], {
    encoding: 'utf8',
    env: { ...process.env, DOCGRAD_TODAY: '2026-09-01' },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.convention, ['heading-line']);
  assert.equal(out.files_total, 4);
  assert.equal(out.files_with_signal, 2); // README 與 CLAUDE.md 有 Last updated 行
  assert.equal(out.coverage_ratio, 0.5);
  // 全部 git 日期 2026-06-15 → age 78 天 > 60 → 四檔皆 stale
  assert.equal(out.stale.length, 4);
  assert.ok(out.stale.every((s) => s.age_days === 78));
  // CLAUDE.md 宣稱 2026-06-01 但 git 2026-06-15 → drift 14 > 7 → mismatch
  assert.deepEqual(out.mismatches, [
    { path: 'CLAUDE.md', claimed: '2026-06-01', actual_git: '2026-06-15', drift_days: 14 },
  ]);
});

test('freshness: convention none → 零訊號、不炸（CLI e2e）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-none-'));
  try {
    fs.cpSync(FIXTURE, tmp, { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.docgrad.yml'),
      'docs_dirs: [docs/]\nentry_files: [CLAUDE.md]\nexclude: [docs/archive/]\nfreshness:\n  convention: none\n'
    );
    const r = spawnSync(process.execPath, [SCRIPT, '--root', tmp], {
      encoding: 'utf8',
      env: { ...process.env, DOCGRAD_TODAY: '2026-09-01' },
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.convention, ['none']);
    assert.equal(out.files_with_signal, 0);
    assert.equal(out.coverage_ratio, 0);
    assert.deepEqual(out.stale, []); // 非 git、無 claimed → age 皆 null
    assert.deepEqual(out.mismatches, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('freshness: 非 git repo → actual_git 為 null、不炸', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-nogit-'));
  fs.cpSync(FIXTURE, tmp, { recursive: true });
  const r = spawnSync(process.execPath, [SCRIPT, '--root', tmp], {
    encoding: 'utf8',
    env: { ...process.env, DOCGRAD_TODAY: '2026-09-01' },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.coverage_ratio, 0.5);
  assert.ok(out.stale.every((s) => s.actual_git === null)); // 落回 claimed 為基準
});

function makeMixedConventionFixture(conventionLine) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-mixed-'));
  fs.mkdirSync(path.join(tmp, 'docs'));
  fs.writeFileSync(
    path.join(tmp, 'docs', 'fm.md'),
    '---\nlast_updated: 2026-07-01\n---\n# FM\n\n走 frontmatter 慣例。\n'
  );
  fs.writeFileSync(
    path.join(tmp, 'docs', 'hl.md'),
    '# HL\n\n> **Last updated:** 2026-07-02\n\n走 heading-line 慣例。\n'
  );
  fs.writeFileSync(
    path.join(tmp, '.docgrad.yml'),
    `docs_dirs: [docs/]\nentry_files: []\nfreshness:\n${conventionLine}\n`
  );
  return tmp;
}

test('freshness: convention 多值（frontmatter,heading-line）→ 兩檔皆有訊號、coverage_ratio=1', () => {
  const tmp = makeMixedConventionFixture(
    '  convention: frontmatter,heading-line\n  field: last_updated\n  heading_field: "Last updated:"'
  );
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.convention, ['frontmatter', 'heading-line']);
    assert.equal(out.files_total, 2);
    assert.equal(out.files_with_signal, 2);
    assert.equal(out.coverage_ratio, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('freshness: convention 單值時同一 fixture 只認一種 → coverage_ratio=0.5', () => {
  const tmpFm = makeMixedConventionFixture('  convention: frontmatter\n  field: last_updated');
  const tmpHl = makeMixedConventionFixture('  convention: heading-line\n  field: "Last updated:"');
  try {
    const rFm = spawnSync(process.execPath, [SCRIPT, '--root', tmpFm], { encoding: 'utf8' });
    assert.equal(rFm.status, 0, rFm.stderr);
    const outFm = JSON.parse(rFm.stdout);
    assert.deepEqual(outFm.convention, ['frontmatter']);
    assert.equal(outFm.coverage_ratio, 0.5);

    const rHl = spawnSync(process.execPath, [SCRIPT, '--root', tmpHl], { encoding: 'utf8' });
    assert.equal(rHl.status, 0, rHl.stderr);
    const outHl = JSON.parse(rHl.stdout);
    assert.deepEqual(outHl.convention, ['heading-line']);
    assert.equal(outHl.coverage_ratio, 0.5);
  } finally {
    fs.rmSync(tmpFm, { recursive: true, force: true });
    fs.rmSync(tmpHl, { recursive: true, force: true });
  }
});

test('freshness: 只設 field 且 convention 含 heading-line → fallback 用 field 當關鍵字（相容舊設定）', () => {
  const tmp = makeMixedConventionFixture('  convention: heading-line\n  field: "Last updated:"');
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.coverage_ratio, 0.5); // 只有 hl.md 命中
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
