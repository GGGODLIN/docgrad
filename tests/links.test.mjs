import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.deepEqual(out.orphans, []); // docs/orphan.md is an orphan on a full run; not judged under scope
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
