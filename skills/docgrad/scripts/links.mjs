#!/usr/bin/env node
// links.mjs — dead links/bad anchors/orphans (reachability computed transitively from index_file + entry_files)
// Usage: node links.mjs [--root <repo>] [--config <file>] [--include <glob>] [--exclude-ledger <path>] [--locate-ledger <path>]; JSON -> stdout.
// When scope-limited, only dead links/bad anchors are emitted: orphans and reachable ratio are
// full-index concepts that go wrong once scope narrows, so they're never computed under scope.
// --exclude-ledger (#54) is a no-op here: only inventory.mjs draws claim candidates from a claim
// ledger; link checking has nothing to do with it. Accepted and ignored, like --include above.
import fs from 'node:fs';
import path from 'node:path';
import {
  loadConfig, collectFiles, parseArgs, fail, docgradMeta,
  extractHeadings, extractLinks, githubSlug, CJK_RE, pathInsideRoot, resolveLinkTarget,
} from './lib.mjs';

const MD_TARGET_RE = /\.(md|mdx|markdown)$/i;


// --- out-of-root link targets (#57) -------------------------------------------------
//
// A link target is **document**-derived, not config-derived, so unlike a configured path it is not
// a hard error: an accidental `../../` link is common, and exiting 1 on one would be a corpus-wide
// regression. It is classified into its own bucket instead, without its existence ever being the
// thing that decides the classification.
//
// Not stat'ing it is the whole fix. Before this, an out-of-root target was passed to existsSync and
// then reported as a dead link when absent and silently dropped when present — an existence oracle
// over the auditor's filesystem, repeatable at will from a repo docgrad was merely grading. The
// oracle **is** that present/absent difference, so relabelling only the present case would leave it
// open. Every branch below is therefore chosen so that nothing outside the root is ever consulted.
//
//   1. A lexically escaping target (`../…`, or `/…` normalising above the root) is classified with
//      **no filesystem call at all** — the strongest form of "never stat'ed", and the shape the
//      fixtures pin down.
//   2. A lexically in-root target is resolved through symlinks (realpath) before it is trusted.
//      A symlinked directory, or a symlinked file, whose target leaves the root lands in the same
//      bucket; the realpath of a symlinked *directory* resolves whether or not the file under it
//      exists, so this branch too cannot be turned into an oracle.
//   3. The one asymmetric case left is a **dangling** symlink: realpath cannot resolve it, so
//      containment climbs past it to its (contained) parent and would answer "inside", after which
//      the dead/alive split would again say whether the link's target exists. So an entry that is a
//      symlink and does not resolve is put in the out-of-root bucket too. The cost is that a
//      dangling *in-root* symlink is reported as out-of-root rather than dead — a rare case, and a
//      broken file rather than a broken link. Fail closed.
//
// Branches 2 and 3 do make filesystem calls, on a path the repo named inside its own tree — but
// each of them answers the same way whether or not anything exists outside the root, which is the
// property that closes the oracle. Branch 1 makes none at all, and everything that reaches
// existsSync below resolves inside the root.
function escapesLexically(resolved) {
  return resolved === '..' || resolved.startsWith('../');
}

function isUnresolvedSymlink(abs) {
  let st;
  try {
    st = fs.lstatSync(abs); // never follows the final component
  } catch {
    return false; // not there at all: an ordinary in-root miss, i.e. a dead link
  }
  if (!st.isSymbolicLink()) return false;
  try {
    fs.realpathSync(abs);
    return false;
  } catch {
    return true;
  }
}

function targetOutOfRoot(root, resolved) {
  if (escapesLexically(resolved)) return true;
  const abs = path.join(root, resolved);
  return !pathInsideRoot(root, abs) || isUnresolvedSymlink(abs);
}

try {
  const { root, configFile, include, excludeLedger, locateLedger } = parseArgs();
  const scoped = include.length > 0;
  const config = loadConfig(root, configFile);
  const locateLedgerNoteText = locateLedger
    ? '--locate-ledger is a no-op for this script: only inventory.mjs can locate a ledgered claim in the corpus, and link checking has nothing to do with it'
    : null;
  const excludeLedgerNoteText = excludeLedger
    ? '--exclude-ledger is a no-op for this script: only inventory.mjs draws claim candidates from a claim ledger, and link checking has nothing to do with it'
    : null;
  const { included } = collectFiles(root, config, { include });
  const includedSet = new Set(included);
  const readText = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const headingCache = new Map();
  const slugsOf = (rel) => {
    if (!headingCache.has(rel)) headingCache.set(rel, extractHeadings(readText(rel)));
    return headingCache.get(rel);
  };

  const dead_links = [];
  const out_of_root_links = [];
  const bad_anchors = [];
  const graph = new Map(included.map((p) => [p, new Set()]));
  let total_links = 0;

  for (const rel of included) {
    for (const { target, line } of extractLinks(readText(rel))) {
      const link = resolveLinkTarget(root, rel, target);
      if (link === null) continue; // external scheme
      total_links += 1;
      const { resolved, anchor } = link; // a pure anchor link resolves to the document itself
      // Classified before anything is stat'ed, and never counted as dead: "this link leaves the
      // repository" and "this link points at nothing" are different facts, and the second one is
      // the one that would have to be answered by looking outside the root.
      if (resolved === null || targetOutOfRoot(root, resolved)) {
        out_of_root_links.push({ file: rel, line, target });
        continue;
      }
      if (!fs.existsSync(path.join(root, resolved))) {
        dead_links.push({ file: rel, line, target });
        continue;
      }
      if (includedSet.has(resolved)) graph.get(rel).add(resolved);
      if (anchor && MD_TARGET_RE.test(resolved) && includedSet.has(resolved)) {
        if (!slugsOf(resolved).has(githubSlug(anchor))) {
          bad_anchors.push({ file: rel, line, target, anchor, cjk_uncertain: CJK_RE.test(anchor) });
        }
      }
    }
  }

  const scopeNoteText = scoped
    ? 'scope-limited: orphans/reachable ratio not computed (reachability is a full-index concept), only dead links and bad anchors are counted'
    : null;
  const combinedNoteText = [scopeNoteText, excludeLedgerNoteText, locateLedgerNoteText].filter(Boolean).join('; ') || null;

  const roots = [config.index_file, ...config.entry_files].filter((p) => p && includedSet.has(p));
  const reachable = new Set(roots);
  const queue = [...roots];
  while (queue.length) {
    for (const next of graph.get(queue.shift()) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        scope: scoped ? include : null,
        // Same position as in inventory.mjs (right after scope) so two scripts' JSON can be
        // compared field by field. It matters most here: orphans changed shape in v1.5.0
        // ([] -> null when not computed, #39), and without this the output cannot say which
        // version of the tool wrote it.
        docgrad: docgradMeta(undefined, config),
        ...(combinedNoteText ? { note: combinedNoteText } : {}),
        total_links,
        dead_links,
        // #57: link targets that resolve outside the repository root. Reported and never fatal —
        // a document can carry an accidental `../../`, and the root is the boundary docgrad
        // measures within, not something a document is forbidden to mention. They are deliberately
        // **not** dead links: their existence was never looked up, and calling them dead would
        // assert the one fact this bucket exists in order not to go and find out.
        out_of_root_links,
        bad_anchors,
        // null when it can't be computed, never [] — an empty array is indistinguishable from
        // "computed, and there are genuinely none", and downstream reads that as "linkage is fine".
        // Same condition as reachable_ratio: under scope, or with no index_file, reachability has
        // no starting point, so orphanhood can't be judged at all.
        orphans: !scoped && config.index_file ? included.filter((p) => !reachable.has(p)) : null,
        reachable_ratio:
          !scoped && config.index_file && included.length > 0
            ? Number((reachable.size / included.length).toFixed(4))
            : null,
      },
      null,
      2
    )}\n`
  );
} catch (err) {
  fail(err.message);
}
