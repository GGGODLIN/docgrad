import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/basic/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/links.mjs', import.meta.url));

test('links: 死鏈/壞錨/孤兒/可達率', () => {
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE], { encoding: 'utf8' }));
  assert.deepEqual(out.dead_links, [{ file: 'docs/guide.md', line: 5, target: './nope.md' }]);
  assert.equal(out.bad_anchors.length, 1);
  assert.equal(out.bad_anchors[0].anchor, '不存在的錨');
  assert.equal(out.bad_anchors[0].cjk_uncertain, true);
  assert.deepEqual(out.orphans, ['docs/orphan.md']);
  assert.equal(out.reachable_ratio, 0.75); // README+CLAUDE 為根 → guide 可達，orphan 不可達
  assert.ok(out.total_links >= 4); // CLAUDE→README、guide 三連結
  assert.equal(out.scope, null);
});

test('links: --include 只採計死鏈/壞錨，孤兒與可達率一律不計', () => {
  const out = JSON.parse(
    execFileSync(process.execPath, [SCRIPT, '--root', FIXTURE, '--include', 'docs/**'], { encoding: 'utf8' })
  );
  assert.deepEqual(out.scope, ['docs/**']);
  assert.match(out.note, /可達率不計/);
  assert.deepEqual(out.orphans, []); // 全量時 docs/orphan.md 是孤兒；scope 下不判
  assert.equal(out.reachable_ratio, null);
  assert.equal(out.dead_links.length, 1); // 死鏈是 per-file 判定，scope 下照抓
  assert.equal(out.bad_anchors.length, 1);
});

test('links: docs_files 比照一般文件判孤兒（它不是可達性起點）', () => {
  // PRODUCT.md 從索引連得到 → 可達；DESIGN.md 沒有任何文件連它 → 孤兒。
  // docs_files 若沒進語料，兩者都不會出現在判定裡，orphans 會是 []。
  const fixture = fileURLToPath(new URL('./fixtures/docs-files/', import.meta.url));
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', fixture], { encoding: 'utf8' }));
  assert.deepEqual(out.orphans, ['DESIGN.md']);
  assert.equal(out.reachable_ratio, 0.8); // 5 份裡 4 份可達
  assert.deepEqual(out.dead_links, []);
});

test('links: index_file 在 docs_dirs 之外且非 entry_file → 仍為可達性起點（不誤判孤兒）', () => {
  const fixture = fileURLToPath(new URL('./fixtures/root-index/', import.meta.url));
  const out = JSON.parse(execFileSync(process.execPath, [SCRIPT, '--root', fixture], { encoding: 'utf8' }));
  assert.deepEqual(out.orphans, []); // 漏收 index_file 時 docs/guide.md 會被誤判成孤兒
  assert.equal(out.reachable_ratio, 1);
  assert.deepEqual(out.dead_links, []);
});
