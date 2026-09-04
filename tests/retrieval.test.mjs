import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/retrieval/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/retrieval.mjs', import.meta.url));

function copyFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-retrieval-'));
  fs.cpSync(FIXTURE, tmp, { recursive: true });
  return tmp;
}

function gitInit(tmp) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@example.com',
  };
  execFileSync('git', ['init', '-q'], { cwd: tmp, env });
  execFileSync('git', ['add', '-A'], { cwd: tmp, env });
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture'], { cwd: tmp, env });
}

function run(root, extraArgs = []) {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...extraArgs], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('retrieval: scenario 命中 docs、depth_from_index、marginal_tokens、code_pointer（無 git → churn/hotness 為 null 且不炸）', () => {
  const tmp = copyFixture();
  try {
    const out = run(tmp);
    assert.equal(out.scenarios.length, 1);
    const [scenario] = out.scenarios;
    assert.equal(scenario.path, 'src/foo/bar.ts');
    assert.equal(scenario.churn_commits, null); // 無 git
    assert.deepEqual(scenario.docs.map((d) => d.doc), ['docs/guide.md']);
    assert.equal(scenario.docs[0].depth_from_index, 1); // README(0) → guide.md(1)
    assert.equal(scenario.fan_in, 1);
    assert.ok(scenario.marginal_tokens > 0);
    assert.equal(scenario.max_depth, 1);
    assert.equal(scenario.code_pointer, true); // bar.ts 內文含 "docs/guide.md"

    assert.deepEqual(
      out.areas.map((a) => a.area),
      ['src/foo', 'src/other']
    );
    const fooArea = out.areas.find((a) => a.area === 'src/foo');
    const otherArea = out.areas.find((a) => a.area === 'src/other');
    assert.equal(fooArea.code_pointer, true);
    assert.equal(fooArea.fan_in, 1);
    assert.equal(otherArea.code_pointer, false); // qux.ts 沒有任何 docs 指針
    assert.equal(otherArea.fan_in, 0);
    assert.equal(out.code_pointer_ratio, 0.5);

    assert.equal(out.index_hotness, null);
    assert.match(out.note, /無 git/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retrieval: 有 git → churn_commits／index_hotness 皆有值', () => {
  const tmp = copyFixture();
  gitInit(tmp);
  try {
    const out = run(tmp);
    assert.equal(out.scenarios[0].churn_commits, 1);
    assert.ok(out.index_hotness);
    assert.equal(out.index_hotness.index_file.path, 'docs/README.md');
    assert.equal(out.index_hotness.median_commits_90d, 1);
    assert.equal(out.index_hotness.ratio, 1);
    assert.ok(out.index_hotness.top5.length >= 2);
    assert.ok(out.index_hotness.top5.every((d) => d.commits_90d >= 0));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retrieval: scenarios 未設定 → note 說明、仍給 areas／index_hotness', () => {
  const tmp = copyFixture();
  fs.writeFileSync(
    path.join(tmp, '.docgrad.yml'),
    'docs_dirs: [docs/]\nentry_files: []\nindex_file: docs/README.md\nsrc_dirs: [src/]\nfreshness:\n  convention: none\n'
  );
  try {
    const out = run(tmp);
    assert.deepEqual(out.scenarios, []);
    assert.equal(out.areas.length, 2);
    assert.match(out.note, /scenarios 未設定/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retrieval: src_dirs 未設定 → areas 降級、note 說明', () => {
  const tmp = copyFixture();
  fs.writeFileSync(
    path.join(tmp, '.docgrad.yml'),
    'docs_dirs: [docs/]\nentry_files: []\nindex_file: docs/README.md\nfreshness:\n  convention: none\n'
  );
  try {
    const out = run(tmp);
    assert.deepEqual(out.areas, []);
    assert.equal(out.code_pointer_ratio, null);
    assert.match(out.note, /src_dirs 未設定/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retrieval: --include 不生效，note 說明理由（scope 仍回 null）', () => {
  const tmp = copyFixture();
  try {
    const out = run(tmp, ['--include', 'docs/guide.md']);
    assert.equal(out.scope, null);
    assert.equal(out.scenarios.length, 1); // 未因 --include 而縮減
    assert.match(out.note, /--include 對本腳本不生效/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retrieval: 無 .docgrad.yml → exit 1＋stderr 導向 init', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /請先執行 \/docgrad init/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
