import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { estimateTokens } from '../scripts/lib.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/retrieval/', import.meta.url));
const ENTRY_CHAIN_FIXTURE = fileURLToPath(new URL('./fixtures/retrieval-entry-chain/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/retrieval.mjs', import.meta.url));

function copyFixture(src = FIXTURE) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-retrieval-'));
  fs.cpSync(src, tmp, { recursive: true });
  return tmp;
}

// Token total for these files with each file counted once — the definition of marginal_tokens
// (see reference/rubric.md, Token economy).
function tokensOfFiles(root, rels) {
  return [...new Set(rels)].reduce(
    (sum, rel) => sum + estimateTokens(fs.readFileSync(path.join(root, rel), 'utf8')),
    0
  );
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

test('retrieval: scenario hits docs, depth_from_index, marginal_tokens, code_pointer (no git -> churn/hotness are null, no crash)', () => {
  const tmp = copyFixture();
  try {
    const out = run(tmp);
    assert.equal(out.scenarios.length, 1);
    const [scenario] = out.scenarios;
    assert.equal(scenario.path, 'src/foo/bar.ts');
    assert.equal(scenario.churn_commits, null); // no git
    assert.deepEqual(scenario.docs.map((d) => d.doc), ['docs/guide.md']); // wide.md only mentions `src/` (i.e. the src_dir itself) generically, which doesn't count as a hit
    assert.equal(scenario.docs[0].depth_from_index, 1); // README(0) -> guide.md(1)
    assert.equal(scenario.fan_in, 1);
    assert.ok(scenario.marginal_tokens > 0);
    assert.equal(scenario.max_depth, 1);
    assert.equal(scenario.code_pointer, true); // bar.ts's content contains "docs/guide.md"

    assert.deepEqual(
      out.areas.map((a) => a.area),
      ['src/foo', 'src/other']
    );
    const fooArea = out.areas.find((a) => a.area === 'src/foo');
    const otherArea = out.areas.find((a) => a.area === 'src/other');
    assert.equal(fooArea.code_pointer, true);
    assert.equal(fooArea.fan_in, 1);
    assert.equal(otherArea.code_pointer, false); // qux.ts has no doc pointer at all
    assert.equal(otherArea.fan_in, 0);
    assert.equal(out.code_pointer_ratio, 0.5);

    assert.equal(out.index_hotness, null);
    assert.match(out.note, /no git/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retrieval: with git -> churn_commits/index_hotness both have values', () => {
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

test('retrieval: scenarios unset -> note explains it, areas/index_hotness still given', () => {
  const tmp = copyFixture();
  fs.writeFileSync(
    path.join(tmp, '.docgrad.yml'),
    'docs_dirs: [docs/]\nentry_files: []\nindex_file: docs/README.md\nsrc_dirs: [src/]\nfreshness:\n  convention: none\n'
  );
  try {
    const out = run(tmp);
    assert.deepEqual(out.scenarios, []);
    assert.equal(out.areas.length, 2);
    assert.match(out.note, /scenarios is unset/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retrieval: src_dirs unset -> areas degrades, note explains it', () => {
  const tmp = copyFixture();
  fs.writeFileSync(
    path.join(tmp, '.docgrad.yml'),
    'docs_dirs: [docs/]\nentry_files: []\nindex_file: docs/README.md\nfreshness:\n  convention: none\n'
  );
  try {
    const out = run(tmp);
    assert.deepEqual(out.areas, []);
    assert.equal(out.code_pointer_ratio, null);
    assert.match(out.note, /src_dirs is unset/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retrieval: --include is a no-op, note explains why (scope still returns null)', () => {
  const tmp = copyFixture();
  try {
    const out = run(tmp, ['--include', 'docs/guide.md']);
    assert.equal(out.scope, null);
    assert.equal(out.scenarios.length, 1); // not narrowed by --include
    assert.match(out.note, /--include is a no-op for this script/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// #38 part 1: marginal_tokens = entry_files + the index chain + the anchoring docs, with each
// file counted once. Before the fix an entry file went into both entryTokens and marginalSet.
test('retrieval: marginal_tokens does not double-count an entry file that sits on the index chain', () => {
  const tmp = copyFixture(ENTRY_CHAIN_FIXTURE);
  try {
    const out = run(tmp);
    const [scenario] = out.scenarios;
    assert.deepEqual(scenario.docs.map((d) => d.doc), ['docs/guide.md', 'docs/loose.md']);
    // Index chain: README(0) -> entry(1) -> guide(2); loose.md is unreachable, so it only counts itself.
    assert.equal(scenario.docs.find((d) => d.doc === 'docs/guide.md').depth_from_index, 2);
    assert.equal(scenario.docs.find((d) => d.doc === 'docs/loose.md').depth_from_index, null);

    const distinct = ['EXTRA.md', 'docs/entry.md', 'docs/README.md', 'docs/guide.md', 'docs/loose.md'];
    const expected = tokensOfFiles(tmp, distinct);
    assert.equal(scenario.marginal_tokens, expected);
    // If docs/entry.md were counted twice the difference would be exactly its tokens — pin the old behaviour out.
    assert.notEqual(scenario.marginal_tokens, expected + tokensOfFiles(tmp, ['docs/entry.md']));
    // EXTRA.md is on no chain and must still be counted once (guards against over-correcting by
    // dropping entryTokens altogether).
    assert.ok(scenario.marginal_tokens > tokensOfFiles(tmp, distinct.slice(1)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retrieval: an entry file that is itself an unreachable anchoring doc (chainToIndex -> [doc]) is also counted once', () => {
  const tmp = copyFixture(ENTRY_CHAIN_FIXTURE);
  fs.writeFileSync(
    path.join(tmp, '.docgrad.yml'),
    'docs_dirs: [docs/]\nentry_files: [docs/loose.md, EXTRA.md]\nindex_file: docs/README.md\nsrc_dirs: [src/]\nscenarios: [src/foo/bar.ts]\nfreshness:\n  convention: none\n'
  );
  try {
    const out = run(tmp);
    const [scenario] = out.scenarios;
    // Same five files, each once — which file plays the entry role must not change the total.
    assert.equal(
      scenario.marginal_tokens,
      tokensOfFiles(tmp, ['EXTRA.md', 'docs/entry.md', 'docs/README.md', 'docs/guide.md', 'docs/loose.md'])
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retrieval: no .docgrad.yml -> exit 1 + stderr points at init', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Run \/docgrad init first/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
