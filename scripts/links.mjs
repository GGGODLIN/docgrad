#!/usr/bin/env node
// links.mjs — dead links/bad anchors/orphans (reachability computed transitively from index_file + entry_files)
// Usage: node links.mjs [--root <repo>] [--config <file>] [--include <glob>]; JSON -> stdout.
// When scope-limited, only dead links/bad anchors are emitted: orphans and reachable ratio are
// full-index concepts that go wrong once scope narrows, so they're never computed under scope.
import fs from 'node:fs';
import path from 'node:path';
import {
  loadConfig, collectFiles, parseArgs, fail, docgradMeta,
  extractHeadings, extractLinks, githubSlug, CJK_RE,
} from './lib.mjs';

const EXTERNAL_RE = /^(https?:|mailto:|tel:|data:)/i;
const MD_TARGET_RE = /\.(md|mdx|markdown)$/i;

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

try {
  const { root, configFile, include } = parseArgs();
  const scoped = include.length > 0;
  const config = loadConfig(root, configFile);
  const { included } = collectFiles(root, config, { include });
  const includedSet = new Set(included);
  const readText = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const headingCache = new Map();
  const slugsOf = (rel) => {
    if (!headingCache.has(rel)) headingCache.set(rel, extractHeadings(readText(rel)));
    return headingCache.get(rel);
  };

  const dead_links = [];
  const bad_anchors = [];
  const graph = new Map(included.map((p) => [p, new Set()]));
  let total_links = 0;

  for (const rel of included) {
    for (const { target, line } of extractLinks(readText(rel))) {
      if (EXTERNAL_RE.test(target)) continue;
      total_links += 1;
      const hashIndex = target.indexOf('#');
      const rawPath = safeDecode(hashIndex === -1 ? target : target.slice(0, hashIndex));
      const anchor = hashIndex === -1 ? null : safeDecode(target.slice(hashIndex + 1));
      const resolved =
        rawPath === ''
          ? rel // a pure anchor link points at itself
          : rawPath.startsWith('/')
            ? path.posix.normalize(rawPath.slice(1))
            : path.posix.normalize(path.posix.join(path.posix.dirname(rel), rawPath));
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
        ...(scoped
          ? { note: 'scope-limited: orphans/reachable ratio not computed (reachability is a full-index concept), only dead links and bad anchors are counted' }
          : {}),
        total_links,
        dead_links,
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
