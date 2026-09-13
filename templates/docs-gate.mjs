#!/usr/bin/env node
// docs-gate.mjs — CI gate script for graduation (a docgrad-produced template, **not installed by docgrad**)
//
// This script deliberately does **not import** docgrad's lib.mjs: it gets copied into your
// repo, decoupled from docgrad's install path. It does exactly one thing — call the already
// installed docgrad measurement scripts, read back the JSON, apply thresholds, and exit non-zero
// on a violation. You decide the thresholds; docgrad doesn't decide how strict to be for you.
//
// Usage:
//   DOCGRAD_DIR=/path/to/docgrad node docs-gate.mjs [--root <repo>]
//
// If DOCGRAD_DIR isn't found, it guesses once along common plugin install locations,
// and reports a clear error if it still can't find one.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

// ---- Thresholds: change these, not the judging logic ---------------------------------------------
const THRESHOLDS = {
  max_dead_links: 0, // not a single dead link allowed into main
  max_bad_anchors: 0, // same for bad anchors (no more false positives once slugs align with GitHub)
  max_orphans: 0, // a doc unreachable from the index = an agent can't retrieve it
  min_freshness_coverage: 0.9, // date-signal coverage ratio
  max_entry_cost_tokens: 5000, // entry-file fixed cost: the tax every task has to pay
};

function resolveDocgradDir() {
  if (process.env.DOCGRAD_DIR) {
    const dir = path.resolve(process.env.DOCGRAD_DIR);
    if (fs.existsSync(path.join(dir, 'scripts/links.mjs'))) return dir;
    console.error(`docs-gate: could not find scripts/links.mjs under DOCGRAD_DIR=${dir}. Check that the path points at docgrad's root directory.`);
    process.exit(2);
  }
  const candidates = [
    path.join(os.homedir(), '.claude/skills/docgrad'),
    ...['claude-plugins-official', 'docgrad'].map((m) =>
      path.join(os.homedir(), '.claude/plugins/cache', m, 'docgrad')
    ),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'scripts/links.mjs'))) return c;
  }
  console.error(
    'docs-gate: could not find a docgrad install directory. Set the DOCGRAD_DIR environment variable to the docgrad repo/plugin root.'
  );
  process.exit(2); // 2 = environment problem, kept separate from 1 = docs failed the gate, so CI can tell whose fault it is
}

function runScript(docgradDir, name, root) {
  const script = path.join(docgradDir, 'scripts', name);
  try {
    return JSON.parse(execFileSync(process.execPath, [script, '--root', root], { encoding: 'utf8' }));
  } catch (err) {
    console.error(`docs-gate: ${name} failed to run — ${err.message}`);
    process.exit(2);
  }
}

const rootIdx = process.argv.indexOf('--root');
const root = path.resolve(rootIdx >= 0 && process.argv[rootIdx + 1] ? process.argv[rootIdx + 1] : process.cwd());
const docgradDir = resolveDocgradDir();

const links = runScript(docgradDir, 'links.mjs', root);
const freshness = runScript(docgradDir, 'freshness.mjs', root);
const inventory = runScript(docgradDir, 'inventory.mjs', root);

const violations = [];
const check = (label, actual, ok, limit) => {
  if (!ok) violations.push(`${label}: ${actual} (threshold ${limit})`);
};

check('dead links', links.dead_links.length, links.dead_links.length <= THRESHOLDS.max_dead_links, THRESHOLDS.max_dead_links);
check('bad anchors', links.bad_anchors.length, links.bad_anchors.length <= THRESHOLDS.max_bad_anchors, THRESHOLDS.max_bad_anchors);
// links.mjs may return orphans as null — with no index_file (or under scope) reachability has no
// starting point, so what comes back is "not computed", not "zero orphans". The gate must not treat
// that as a pass: a threshold that can't be verified is a threshold that isn't being enforced.
// It counts as exit 1 (docs failed the gate) rather than 2 (environment problem) — having no index
// at all is itself a hole in the documentation system, not a mistake by whoever ran the gate.
if (links.orphans === null) {
  violations.push(
    'orphans: not computed — .docgrad.yml has no index_file, so reachability has no starting point (this is NOT "zero orphans")'
  );
} else {
  check('orphans', links.orphans.length, links.orphans.length <= THRESHOLDS.max_orphans, THRESHOLDS.max_orphans);
}
check(
  'freshness coverage',
  freshness.coverage_ratio,
  freshness.coverage_ratio >= THRESHOLDS.min_freshness_coverage,
  `>= ${THRESHOLDS.min_freshness_coverage}`
);
check(
  'entry-file fixed cost',
  `${inventory.entry_cost.tokens_est} tokens`,
  inventory.entry_cost.tokens_est <= THRESHOLDS.max_entry_cost_tokens,
  `<= ${THRESHOLDS.max_entry_cost_tokens}`
);

if (violations.length) {
  console.error('docs-gate: documentation failed the gate\n');
  for (const v of violations) console.error(`  ✗ ${v}`);
  if (links.dead_links.length) {
    console.error('\nDead link details:');
    for (const d of links.dead_links) console.error(`  ${d.file}:${d.line} → ${d.target}`);
  }
  if (links.orphans?.length) console.error(`\nOrphans: ${links.orphans.join(', ')}`);
  process.exit(1);
}

console.log(
  `docs-gate: passed (dead links 0 / bad anchors 0 / orphans 0 / freshness ${freshness.coverage_ratio} / ` +
    `fixed cost ${inventory.entry_cost.tokens_est} tokens)`
);
