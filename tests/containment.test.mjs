// #57 — docgrad must not read or probe filesystem content outside the root it was pointed at.
//
// The repo being graded controls both `.docgrad.yml` and the symlinks in its own tree, and docgrad
// is documented as a tool you run against repos you did not write. Each test below is one route out
// of the root; every one of them asserts that the run fails closed **and** that the planted secret
// never reaches stdout, because "exit 1" alone would still pass if the content had been printed
// first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const INVENTORY = fileURLToPath(new URL('../skills/docgrad/scripts/inventory.mjs', import.meta.url));
const COVERAGE = fileURLToPath(new URL('../skills/docgrad/scripts/coverage.mjs', import.meta.url));
const RETRIEVAL = fileURLToPath(new URL('../skills/docgrad/scripts/retrieval.mjs', import.meta.url));
const LINKS = fileURLToPath(new URL('../skills/docgrad/scripts/links.mjs', import.meta.url));
const FRESHNESS = fileURLToPath(new URL('../skills/docgrad/scripts/freshness.mjs', import.meta.url));
const FS_TRACE = fileURLToPath(new URL('./helpers/fs-trace.mjs', import.meta.url));

const SECRET = 'S3CRET-CANARY-9f2b1d';
// Shaped like a claim candidate on purpose: a path-shaped backtick span is what puts a line's
// **text** into inventory.mjs's output, so if this file were ever collected the secret would be
// printed verbatim rather than merely counted.
const SECRET_DOC = `# outside\n\nthe key used by \`src/foo/bar.ts › go()\` is ${SECRET}.\n`;
const SECRET_CODE = `// ${SECRET}\n// mentions docs/ so hasCodePointer() would return true if this were read\n`;

// base/
//   secret.txt            <- reachable from the root as ../../secret.txt
//   outside/{notes.md,leak.ts,sub/deep.md}
//   nest/repo/            <- the root every run is pointed at
function makeWorld() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'docgrad-contain-'));
  fs.writeFileSync(path.join(base, 'secret.txt'), SECRET_DOC);
  fs.mkdirSync(path.join(base, 'outside', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(base, 'outside', 'notes.md'), SECRET_DOC);
  fs.writeFileSync(path.join(base, 'outside', 'sub', 'deep.md'), SECRET_DOC);
  fs.writeFileSync(path.join(base, 'outside', 'leak.ts'), SECRET_CODE);

  const root = path.join(base, 'nest', 'repo');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'foo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'README.md'), '# index\n\n[guide](./guide.md)\n');
  fs.writeFileSync(path.join(root, 'docs', 'guide.md'), '# guide\n\nsee `src/foo/bar.ts › go()`.\n');
  fs.writeFileSync(path.join(root, 'src', 'foo', 'bar.ts'), 'export function go() {}\n');
  return { base, root };
}

function writeConfig(root, body) {
  fs.writeFileSync(path.join(root, '.docgrad.yml'), body);
}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

// Every escape route asserts the same three things, so a route that starts leaking cannot pass by
// failing for some unrelated reason.
function assertContained(r, field) {
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}: ${r.stderr}`);
  assert.ok(!r.stdout.includes(SECRET), 'the secret must never reach stdout');
  assert.match(r.stderr, new RegExp(field));
  assert.match(r.stderr, /--root/); // the resolution base has to be named: paths are not relative to the config file
}

function cleanup(base) {
  fs.rmSync(base, { recursive: true, force: true });
}

// --- the exploit matrix -------------------------------------------------------------

test('#57 (a) docs_dirs: ["../"] — a configured directory above the root is refused', () => {
  const { base, root } = makeWorld();
  try {
    writeConfig(root, "docs_dirs: ['../']\nindex_file: null\n");
    assertContained(run(INVENTORY, ['--root', root]), 'docs_dirs');
  } finally {
    cleanup(base);
  }
});

test('#57 (b) docs_files: ["../../secret.txt"] — no .md anywhere, proving the extension-free route', () => {
  // pushSingleFile applies no extension filter (and this change deliberately does not add one), so
  // containment is the only thing standing between this field and any file on the machine.
  const { base, root } = makeWorld();
  try {
    writeConfig(root, "docs_dirs: [docs/]\ndocs_files: ['../../secret.txt']\nindex_file: docs/README.md\n");
    assertContained(run(INVENTORY, ['--root', root]), 'docs_files');
  } finally {
    cleanup(base);
  }
});

test('#57 (c) a committed symlink used as a docs_dir is refused', () => {
  const { base, root } = makeWorld();
  try {
    fs.symlinkSync(path.join(base, 'outside'), path.join(root, 'docs-x'));
    writeConfig(root, "docs_dirs: ['docs-x/']\nindex_file: null\n");
    assertContained(run(INVENTORY, ['--root', root]), 'docs_dirs');
  } finally {
    cleanup(base);
  }
});

test('#57 (d) the same symlink spelled so it looks inside the root — the realpath-vs-path.resolve test', () => {
  // `docs-x/sub/` resolves **lexically** to <root>/docs-x/sub, which passes any path.resolve +
  // prefix check; readdirSync then follows the link straight out. Only a realpath-based check can
  // see this, which is why this fixture and (c) are not the same test.
  const { base, root } = makeWorld();
  try {
    fs.symlinkSync(path.join(base, 'outside'), path.join(root, 'docs-x'));
    writeConfig(root, "docs_dirs: ['docs-x/sub/']\nindex_file: null\n");
    const r = run(INVENTORY, ['--root', root]);
    assertContained(r, 'docs_dirs');
    assert.ok(!r.stdout.includes('deep.md'));
  } finally {
    cleanup(base);
  }
});

test('#57 (e) a *.md symlink inside docs_dirs whose target is outside the root is refused', () => {
  const { base, root } = makeWorld();
  try {
    fs.symlinkSync(path.join(base, 'outside', 'notes.md'), path.join(root, 'docs', 'notes.md'));
    writeConfig(root, 'docs_dirs: [docs/]\nindex_file: docs/README.md\n');
    assertContained(run(INVENTORY, ['--root', root]), 'docs_dirs');
  } finally {
    cleanup(base);
  }
});

test('#57 (f) src_dirs: ["../"] is refused by all three scripts that read src_dirs', () => {
  const { base, root } = makeWorld();
  try {
    writeConfig(root, "docs_dirs: [docs/]\nsrc_dirs: ['../']\nindex_file: docs/README.md\n");
    for (const script of [INVENTORY, COVERAGE, RETRIEVAL]) {
      assertContained(run(script, ['--root', root]), 'src_dirs');
    }
  } finally {
    cleanup(base);
  }
});

test('#57 (g) scenarios: ["../x.js"] is refused', () => {
  const { base, root } = makeWorld();
  try {
    fs.writeFileSync(path.join(base, 'nest', 'x.js'), SECRET_CODE);
    writeConfig(root, "docs_dirs: [docs/]\nsrc_dirs: [src/]\nscenarios: ['../x.js']\nindex_file: docs/README.md\n");
    assertContained(run(RETRIEVAL, ['--root', root]), 'scenarios');
  } finally {
    cleanup(base);
  }
});

test('#57 (h) a symlinked file inside a contained src_dir is not read by retrieval', () => {
  // The code-side counterpart of (e): walkFiles pushes any non-directory dirent, and
  // hasCodePointer() then reads the body. The src_dir itself is perfectly contained here.
  const { base, root } = makeWorld();
  try {
    fs.symlinkSync(path.join(base, 'outside', 'leak.ts'), path.join(root, 'src', 'foo', 'leak.ts'));
    writeConfig(root, 'docs_dirs: [docs/]\nsrc_dirs: [src/]\nindex_file: docs/README.md\n');
    assertContained(run(RETRIEVAL, ['--root', root]), 'src_dirs');
  } finally {
    cleanup(base);
  }
});

// --- the allow matrix ---------------------------------------------------------------

test('#57 allow: a *.md symlink inside docs_dirs whose target is inside the root is collected', () => {
  const { base, root } = makeWorld();
  try {
    fs.symlinkSync('./guide.md', path.join(root, 'docs', 'alias.md')); // in-root alias, the #51 shape
    writeConfig(root, 'docs_dirs: [docs/]\nindex_file: docs/README.md\n');
    const r = run(INVENTORY, ['--root', root]);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.files.map((f) => f.path).sort(), ['docs/README.md', 'docs/alias.md', 'docs/guide.md']);
  } finally {
    cleanup(base);
  }
});

test('#57 allow: a root that is itself a symlink (the guard for not realpathing --root in parseArgs)', () => {
  // Every fixture root in this suite is a mkdtemp under os.tmpdir(), and on darwin /var -> private/var.
  // If the root were not realpathed inside the containment helper — or if it were realpathed in
  // parseArgs, changing what --root means — this run would report every one of its own files as
  // out-of-root.
  const { base, root } = makeWorld();
  try {
    writeConfig(root, 'docs_dirs: [docs/]\nsrc_dirs: [src/]\nindex_file: docs/README.md\n');
    const linkRoot = path.join(base, 'link-root');
    fs.symlinkSync(root, linkRoot);
    const direct = run(INVENTORY, ['--root', root]);
    const viaLink = run(INVENTORY, ['--root', linkRoot]);
    assert.equal(direct.status, 0, direct.stderr);
    assert.equal(viaLink.status, 0, viaLink.stderr);
    assert.deepEqual(
      JSON.parse(viaLink.stdout).files.map((f) => f.path),
      JSON.parse(direct.stdout).files.map((f) => f.path)
    );
    // The other four scripts take the same route through the same helper.
    for (const script of [COVERAGE, RETRIEVAL, LINKS]) {
      assert.equal(run(script, ['--root', linkRoot]).status, 0, `${script} via a symlinked root`);
    }
  } finally {
    cleanup(base);
  }
});

test('#57 allow: --config outside the root keeps working (it is exempt, by design)', () => {
  const { base, root } = makeWorld();
  try {
    const cfg = path.join(base, 'external.yml');
    fs.writeFileSync(cfg, 'docs_dirs: [docs/]\nindex_file: docs/README.md\n');
    const r = run(INVENTORY, ['--root', root, '--config', cfg]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).files.map((f) => f.path), ['docs/README.md', 'docs/guide.md']);
  } finally {
    cleanup(base);
  }
});

test('#57 no corpus drift: an in-root non-markdown docs_files entry is still collected', () => {
  // The guard against "fixing" pushSingleFile's missing extension filter in the same change:
  // `docs_files: ['NOTES.txt']` is legitimate today, and dropping it would move files_total, the
  // freshness denominator and the pollution denominator for a repo doing nothing wrong.
  const { base, root } = makeWorld();
  try {
    fs.writeFileSync(path.join(root, 'NOTES.txt'), 'plain text notes\n');
    writeConfig(root, 'docs_dirs: [docs/]\ndocs_files: [NOTES.txt]\nindex_file: docs/README.md\n');
    const r = run(INVENTORY, ['--root', root]);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.files.map((f) => f.path), ['NOTES.txt', 'docs/README.md', 'docs/guide.md']);
    assert.equal(out.totals.files, 3);
    // The freshness denominator is one of the numbers an extension filter would have moved, so it
    // is asserted here rather than inferred from the corpus listing.
    const fresh = run(FRESHNESS, ['--root', root]);
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.equal(JSON.parse(fresh.stdout).files_total, 3);
  } finally {
    cleanup(base);
  }
});

// --- links.mjs: the existence oracle ------------------------------------------------

function linksWorld() {
  const { base, root } = makeWorld();
  fs.writeFileSync(
    path.join(root, 'docs', 'guide.md'),
    '# guide\n\n[out](../../../probe.txt)\n[gone](./nope.md)\n'
  );
  writeConfig(root, 'docs_dirs: [docs/]\nindex_file: docs/README.md\n');
  return { base, root, probe: path.join(base, 'probe.txt') };
}

test('#57/F4 links: an out-of-root target is classified identically whether or not it exists', () => {
  const { base, root, probe } = linksWorld();
  try {
    const absent = JSON.parse(run(LINKS, ['--root', root]).stdout);
    fs.writeFileSync(probe, SECRET_DOC);
    const present = JSON.parse(run(LINKS, ['--root', root]).stdout);

    assert.deepEqual(
      { dead: absent.dead_links, out: absent.out_of_root_links, total: absent.total_links },
      { dead: present.dead_links, out: present.out_of_root_links, total: present.total_links },
      'the present/absent difference IS the oracle; the two classifications must be identical'
    );
    assert.deepEqual(absent.out_of_root_links, [
      { file: 'docs/guide.md', line: 3, target: '../../../probe.txt' },
    ]);
    // Still not fatal, and the in-root dead link is still found: this is a new bucket, not a new
    // failure mode and not a silent widening of dead_links.
    assert.deepEqual(absent.dead_links, [{ file: 'docs/guide.md', line: 4, target: './nope.md' }]);
  } finally {
    cleanup(base);
  }
});

test('#57/F4 links: neither run stats the out-of-root path at all', () => {
  const { base, root, probe } = linksWorld();
  try {
    const traceOf = (label) => {
      const traceFile = path.join(base, `trace-${label}.txt`);
      const r = spawnSync(process.execPath, [FS_TRACE, traceFile, LINKS, '--root', root], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return fs.readFileSync(traceFile, 'utf8').split('\n').filter(Boolean);
    };
    const probed = (trace) =>
      trace.filter((p) => path.resolve(p) === path.resolve(probe));

    assert.deepEqual(probed(traceOf('absent')), []);
    fs.writeFileSync(probe, SECRET_DOC);
    assert.deepEqual(probed(traceOf('present')), []);
  } finally {
    cleanup(base);
  }
});

test('#57/F4 links: an in-root symlink pointing out is the same oracle, and is closed the same way', () => {
  // The `../` spelling is not the only way to name a path outside the root: a committed symlink
  // that is never part of the corpus does it too, and a link to it would otherwise be answered by
  // existsSync following the link.
  const { base, root } = makeWorld();
  const mk = (target) => {
    const probe = path.join(root, 'probe.md');
    fs.rmSync(probe, { force: true });
    fs.symlinkSync(target, probe);
    return JSON.parse(run(LINKS, ['--root', root]).stdout);
  };
  try {
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), '# guide\n\n[p](../probe.md)\n');
    writeConfig(root, 'docs_dirs: [docs/]\nindex_file: docs/README.md\n');
    const present = mk(path.join(base, 'outside', 'notes.md'));
    const absent = mk(path.join(base, 'outside', 'does-not-exist.md'));
    assert.deepEqual(present.out_of_root_links, absent.out_of_root_links);
    assert.deepEqual(present.dead_links, absent.dead_links);
    assert.deepEqual(present.out_of_root_links, [
      { file: 'docs/guide.md', line: 3, target: '../probe.md' },
    ]);
  } finally {
    cleanup(base);
  }
});
