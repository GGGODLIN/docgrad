import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/basic/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../skills/docgrad/scripts/freshness.mjs', import.meta.url));

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

test('freshness: --exclude-ledger is a no-op, note explains why (#54)', () => {
  const out = JSON.parse(
    execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE, '--exclude-ledger', '/nonexistent/ledger.jsonl'], { encoding: 'utf8' })
  );
  assert.match(out.note, /--exclude-ledger is a no-op for this script/);
});

test('freshness: without --exclude-ledger there is no note field at all (unchanged from before this flag existed)', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE], { encoding: 'utf8' }));
  assert.ok(!('note' in out));
});

test('freshness: coverage/stale/mismatch (DOCGRAD_TODAY pins today)', () => {
  const tmp = makeGitFixture();
  const r = spawnSync(process.execPath, [SCRIPT, '--root', tmp], {
    encoding: 'utf8',
    env: { ...process.env, DOCGRAD_TODAY: '2026-09-01' },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.convention, ['heading-line']);
  assert.equal(out.files_total, 4);
  assert.equal(out.files_with_signal, 2); // README and CLAUDE.md have a Last updated line
  assert.equal(out.coverage_ratio, 0.5);
  // all git dates are 2026-06-15 -> age 78 days > 60 -> all four files are stale
  assert.equal(out.stale.length, 4);
  assert.ok(out.stale.every((s) => s.age_days === 78));
  // CLAUDE.md claims 2026-06-01 but git says 2026-06-15 -> drift 14 > 7 -> mismatch
  assert.deepEqual(out.mismatches, [
    { path: 'CLAUDE.md', claimed: '2026-06-01', actual_git: '2026-06-15', drift_days: 14 },
  ]);
});

test('freshness: convention none -> zero signal, no crash (CLI e2e)', () => {
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
    assert.deepEqual(out.stale, []); // no git, no claimed -> age is always null
    assert.deepEqual(out.mismatches, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('freshness: not a git repo -> actual_git is null, no crash', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-nogit-'));
  fs.cpSync(FIXTURE, tmp, { recursive: true });
  const r = spawnSync(process.execPath, [SCRIPT, '--root', tmp], {
    encoding: 'utf8',
    env: { ...process.env, DOCGRAD_TODAY: '2026-09-01' },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.coverage_ratio, 0.5);
  assert.ok(out.stale.every((s) => s.actual_git === null)); // falls back to claimed as the basis
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

test('freshness: convention with multiple values (frontmatter,heading-line) -> both files get a signal, coverage_ratio=1', () => {
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

test('freshness: a single-value convention only recognizes one form in the same fixture -> coverage_ratio=0.5', () => {
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

test('freshness: only field set with convention including heading-line -> falls back to field as the keyword (compatible with old configs)', () => {
  const tmp = makeMixedConventionFixture('  convention: heading-line\n  field: "Last updated:"');
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.coverage_ratio, 0.5); // only hl.md matches
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("freshness: docgrad's own convergence commit doesn't count as a content update (no self-pollution)", () => {
  // What actually happened on oikos on 2026-07-13: round 1 backfilled last_updated on 39 files,
  // and that commit itself pushed those files' git dates to that same day, so round 2 saw 38 false mismatches.
  const tmp = makeGitFixture();
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@example.com',
    GIT_AUTHOR_DATE: '2026-08-20T12:00:00', GIT_COMMITTER_DATE: '2026-08-20T12:00:00',
  };
  // Simulate a docgrad convergence: only the date line changes, and the commit message follows improve.md's fixed format.
  const claude = path.join(tmp, 'CLAUDE.md');
  fs.writeFileSync(claude, fs.readFileSync(claude, 'utf8').replace('2026-06-01', '2026-06-15'));
  execFileSync('git', ['add', '-A'], { cwd: tmp, env });
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m',
    'docs(docgrad): round 1 convergence — freshness ★1→★4'], { cwd: tmp, env });

  const out = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--root', tmp], {
    encoding: 'utf8',
    env: { ...process.env, DOCGRAD_TODAY: '2026-09-01' },
  }).stdout);
  const claudeRow = out.stale.find((s) => s.path === 'CLAUDE.md');
  // recognizes 2026-06-15 (the most recent non-docgrad commit), not the convergence day of 2026-08-20.
  assert.equal(claudeRow.actual_git, '2026-06-15');
  assert.equal(out.mismatches.length, 0); // the dates already line up, and the convergence commit didn't push the git date away
});

test('freshness: date_concentration catches the signature of a big backfill', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-conc-'));
  try {
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(path.join(tmp, '.docgrad.yml'),
      'docs_dirs: [docs/]\nfreshness:\n  convention: heading-line\n  field: "Last updated:"\n');
    // three files on the same day (a backfill), one file on a different day.
    for (const [name, date] of [['a', '2026-07-13'], ['b', '2026-07-13'], ['c', '2026-07-13'], ['d', '2026-08-01']]) {
      fs.writeFileSync(path.join(tmp, 'docs', `${name}.md`), `# ${name}\n\n> **Last updated:** ${date}\n`);
    }
    const out = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--root', tmp], {
      encoding: 'utf8',
      env: { ...process.env, DOCGRAD_TODAY: '2026-09-01' },
    }).stdout);
    assert.equal(out.coverage_ratio, 1); // full coverage, but the signal actually has no discriminative power
    assert.equal(out.date_concentration.max_same_day_ratio, 0.75);
    assert.equal(out.date_concentration.date, '2026-07-13');
    assert.equal(out.date_concentration.files, 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('freshness: output carries the docgrad fingerprint, right after scope (#45)', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE], { encoding: 'utf8' }));
  assert.equal(typeof out.docgrad.version, 'string');
  assert.notEqual(out.docgrad.version, null); // #47: a null version here is the silent failure mode
  assert.match(out.docgrad.rubric_hash, /^[0-9a-f]{8}$/);
  assert.match(out.docgrad.corpus_hash, /^[0-9a-f]{8}$/);
  // Same placement as inventory.mjs, so the five scripts' JSON can be compared field by field.
  assert.deepEqual(Object.keys(out).slice(0, 2), ['scope', 'docgrad']);
});
