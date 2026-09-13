import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/basic/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/links.mjs', import.meta.url));

test('links: dead links/bad anchors/orphans/reachable ratio', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE], { encoding: 'utf8' }));
  assert.deepEqual(out.dead_links, [{ file: 'docs/guide.md', line: 5, target: './nope.md' }]);
  assert.equal(out.bad_anchors.length, 1);
  assert.equal(out.bad_anchors[0].anchor, '不存在的錨');
  assert.equal(out.bad_anchors[0].cjk_uncertain, true);
  assert.deepEqual(out.orphans, ['docs/orphan.md']);
  assert.equal(out.reachable_ratio, 0.75); // README+CLAUDE are roots -> guide is reachable, orphan is not
  assert.ok(out.total_links >= 4); // CLAUDE->README, guide's three links
  assert.equal(out.scope, null);
});

test('links: --include only counts dead links/bad anchors, orphans and reachable ratio are never computed', () => {
  const out = JSON.parse(
    execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE, '--include', 'docs/**'], { encoding: 'utf8' })
  );
  assert.deepEqual(out.scope, ['docs/**']);
  assert.match(out.note, /reachable ratio/);
  // docs/orphan.md is an orphan on a full run; not judged under scope -> null ("not computed"),
  // never [] ("computed, and there are none")
  assert.equal(out.orphans, null);
  assert.notDeepEqual(out.orphans, []);
  assert.equal(out.reachable_ratio, null);
  assert.equal(out.dead_links.length, 1); // dead links are judged per-file, still caught under scope
  assert.equal(out.bad_anchors.length, 1);
});

test('links: docs_files are judged as orphans like any regular document (not a reachability starting point)', () => {
  // PRODUCT.md is linked from the index -> reachable; DESIGN.md has no document linking to it -> orphan.
  // If docs_files weren't part of the corpus, neither would appear in the judgment and orphans would be [].
  const fixture = fileURLToPath(new URL('./fixtures/docs-files/', import.meta.url));
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', fixture], { encoding: 'utf8' }));
  assert.deepEqual(out.orphans, ['DESIGN.md']);
  assert.equal(out.reachable_ratio, 0.8); // 4 of 5 reachable
  assert.deepEqual(out.dead_links, []);
});

test('links: index_file outside docs_dirs and not an entry_file -> still a reachability starting point (not misjudged as an orphan)', () => {
  const fixture = fileURLToPath(new URL('./fixtures/root-index/', import.meta.url));
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', fixture], { encoding: 'utf8' }));
  assert.deepEqual(out.orphans, []); // missing index_file would misjudge docs/guide.md as an orphan
  assert.equal(out.reachable_ratio, 1);
  assert.deepEqual(out.dead_links, []);
});

test('links: index_file unset -> orphans is null ("not computed"), not [] ("zero orphans")', () => {
  // Regression test for #39: with no index_file there is no reachability starting point. The old
  // code short-circuited to [], so downstream consumers that only read the mechanical output —
  // CI gates, dashboards, agents that skip the rubric — read it as "linkage is fine". Measured on a
  // real repo whose seven documents were all mutually unreachable: it still reported [].
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-noindex-'));
  fs.mkdirSync(path.join(tmp, 'docs'));
  fs.writeFileSync(path.join(tmp, '.docgrad.yml'), 'docs_dirs: [docs/]\nentry_files: []\nindex_file: null\nexclude: []\n');
  // Two documents with no links between them: with an index_file they'd be genuine orphans.
  fs.writeFileSync(path.join(tmp, 'docs/a.md'), '# A\n\nnothing links here.\n');
  fs.writeFileSync(path.join(tmp, 'docs/b.md'), '# B\n\nnothing links here either.\n');

  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', tmp], { encoding: 'utf8' }));
  assert.equal(out.orphans, null);
  assert.notDeepEqual(out.orphans, []); // must be distinguishable from "zero orphans" by value and type
  assert.equal(out.reachable_ratio, null); // same condition, same degree of honesty
  assert.equal(out.scope, null); // not scope-limited — purely the absence of an index

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('links: full run with an index_file -> orphans is still an array, and still finds a real orphan', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE], { encoding: 'utf8' }));
  assert.ok(Array.isArray(out.orphans));
  assert.deepEqual(out.orphans, ['docs/orphan.md']);
});
