#!/usr/bin/env node
// inventory.mjs — document inventory + CJK-aware token measurement + fixed cost/pollution surface + section-level structure metrics
// Usage: node inventory.mjs [--root <repo>] [--config <file>] [--include <glob>]; JSON -> stdout.
import fs from 'node:fs';
import path from 'node:path';
import {
  loadConfig, collectFiles, estimateTokens, parseArgs, fail,
  extractCodeRefs, extractClaimLines, rankClaimCandidates, docgradMeta,
  gitTrackedFiles, GIT_UNAVAILABLE_NOTE,
} from './lib.mjs';

const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+\.)\s+/;

// How many untracked paths to print. The count and the token total are always exact; the list is
// there to make the files identifiable, not to be exhaustive.
const UNTRACKED_LIST_CAP = 20;

function fileType(p, config) {
  if (config.entry_files.includes(p)) return 'entry';
  if (p === config.index_file) return 'index';
  return 'doc';
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function percentile90(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(0.9 * s.length) - 1));
  return s[idx];
}

// H2 section slicing (a "## " outside a fence opens a new section); tokens_est covers the whole
// section's content (not the heading line itself).
function extractH2Sections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = null;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      if (current) current.lines.push(line);
      continue;
    }
    if (!inFence) {
      const m = line.match(/^##\s+(.+?)\s*#*\s*$/);
      if (m) {
        if (current) sections.push(current);
        current = { title: m[1].replace(/[*_`]/g, '').trim(), lines: [] };
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ title: s.title, tokens_est: estimateTokens(s.lines.join('\n')) }));
}

// A rule line = a list item (an optional leading emoji is fine; the test is just whether it
// contains the pattern substring) that also contains rules.pattern.
// anchored = extractCodeRefs can extract coordinates from the line itself.
function extractRuleLines(text, pattern, srcDirs) {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  const rules = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!LIST_ITEM_RE.test(line)) continue;
    if (!line.includes(pattern)) continue;
    const content = line.replace(LIST_ITEM_RE, '').trim();
    rules.push({ chars: content.length, anchored: extractCodeRefs(line, srcDirs).length > 0 });
  }
  return rules;
}

function buildStructure(text, config) {
  const ruleLines = extractRuleLines(text, config.rules.pattern, config.src_dirs);
  return {
    h2: extractH2Sections(text),
    rules: {
      count: ruleLines.length,
      median_chars: median(ruleLines.map((r) => r.chars)),
      p90_chars: percentile90(ruleLines.map((r) => r.chars)),
      anchored_ratio: ruleLines.length
        ? Number((ruleLines.filter((r) => r.anchored).length / ruleLines.length).toFixed(4))
        : 0,
    },
    // for aggregation into totals; not emitted in the JSON (would duplicate rules.count/anchored_ratio's meaning)
    _ruleLines: ruleLines,
  };
}

function measure(rootDir, relPath, config) {
  const text = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
  const structure = buildStructure(text, config);
  const ruleLines = structure._ruleLines;
  delete structure._ruleLines;
  const claimLines = extractClaimLines(text, config.src_dirs);
  return {
    path: relPath,
    bytes: Buffer.byteLength(text),
    tokens_est: estimateTokens(text),
    type: fileType(relPath, config),
    claims: claimLines.length, // lines with extractable code coordinates = the claim-ledger sampling population
    structure,
    _ruleLines: ruleLines, // for internal aggregation; stripped before output
    _claimLines: claimLines,
  };
}

try {
  const { root, configFile, include } = parseArgs();
  const config = loadConfig(root, configFile);
  // One git call, shared between collectFiles (exclude_untracked) and the untracked report below.
  const tracked = gitTrackedFiles(root);
  const { included, excluded } = collectFiles(root, config, { include, tracked });
  const filesRaw = included.map((p) => measure(root, p, config));
  const excludedFiles = excluded.map((p) => measure(root, p, config));
  const rulesTotal = filesRaw.reduce((s, f) => s + f._ruleLines.length, 0);
  const rulesAnchored = filesRaw.reduce((s, f) => s + f._ruleLines.filter((r) => r.anchored).length, 0);
  const claimsTotal = filesRaw.reduce((s2, f) => s2 + f._claimLines.length, 0);
  // A stably-ordered candidate list: the order produced from the same corpus is always the same,
  // so claim-ledger sampling is reproducible. Only the first 60 entries are emitted — the
  // population size is totals.claims_total; this is the pick order for sampling.
  const claimCandidates = rankClaimCandidates(
    filesRaw.map((f) => ({ path: f.path, claims: f._claimLines }))
  ).slice(0, 60);
  const files = filesRaw.map(({ _ruleLines, _claimLines, ...f }) => f);
  const totalTokens = files.reduce((s, f) => s + f.tokens_est, 0);
  const excludedTokens = excludedFiles.reduce((s, f) => s + f.tokens_est, 0);

  // Untracked files among everything this run collected (included + excluded — both sides feed
  // pollution.ratio, which is a rated input). Reporting them is what makes the difference between
  // a working checkout and a clean one visible instead of silent; it does not change the numbers.
  const collected = [...filesRaw, ...excludedFiles];
  const untrackedFiles = tracked === null ? null : collected.filter((f) => !tracked.has(f.path));
  const untracked =
    untrackedFiles === null
      ? { count: null, tokens_est: null, files: null, note: GIT_UNAVAILABLE_NOTE }
      : {
          count: untrackedFiles.length,
          tokens_est: untrackedFiles.reduce((s, f) => s + f.tokens_est, 0),
          files: untrackedFiles.map((f) => f.path).sort().slice(0, UNTRACKED_LIST_CAP),
          ...(untrackedFiles.length > UNTRACKED_LIST_CAP
            ? { note: `list capped: only the first ${UNTRACKED_LIST_CAP} of ${untrackedFiles.length} paths are shown (count/tokens_est cover all of them)` }
            : {}),
        };
  // The ratio itself is left exactly as it was — silently changing everyone's economy rating is
  // the kind of break this tool exists to catch. The note only says the number is checkout-bound.
  const pollutionNote =
    untrackedFiles && untrackedFiles.length
      ? `this ratio includes ${untrackedFiles.length} untracked local file(s) (see "untracked"), so it will differ on a clean checkout of the same commit and two people can arrive at different economy ratings; set exclude_untracked: true in .docgrad.yml to measure the clean-checkout corpus instead`
      : null;
  process.stdout.write(
    `${JSON.stringify(
      {
        scope: include.length ? include : null,
        // history.jsonl's docgrad_version/rubric_hash/corpus_hash all come from here
        docgrad: docgradMeta(undefined, config),
        files,
        totals: {
          files: files.length,
          bytes: files.reduce((s, f) => s + f.bytes, 0),
          tokens_est: totalTokens,
          claims_total: claimsTotal,
          rules_total: rulesTotal,
          rules_anchored_ratio: rulesTotal ? Number((rulesAnchored / rulesTotal).toFixed(4)) : 0,
        },
        claim_candidates: claimCandidates,
        entry_cost: (() => {
          // When scope-limited, count only entry files within the scope — fixed cost is a
          // full-corpus concept, so a scoped report cannot cite it directly.
          // Symlink dedup: multiple entry names pointing at the same real file (kdan-bpm's
          // `CLAUDE.md -> AGENTS.md`) get loaded by an agent as a single file, so summing them by
          // name would double the fixed cost (measured on 2026-09-05: 5,792 vs the true 2,896).
          // Group by realpath, count the same real file once; files still lists every name, and
          // aliases that got folded together are called out.
          const entries = files.filter((f) => f.type === 'entry');
          const seen = new Map();
          const aliases = [];
          for (const f of entries) {
            let key = f.path;
            try {
              key = fs.realpathSync(path.join(root, f.path));
            } catch {
              /* fall back to the path itself when it can't be read — better to double-count than to miss it */
            }
            if (seen.has(key)) {
              aliases.push({ path: f.path, same_file_as: seen.get(key) });
              continue;
            }
            seen.set(key, f.path);
          }
          const counted = new Set(seen.values());
          return {
            files: entries.map((f) => f.path),
            tokens_est: entries
              .filter((f) => counted.has(f.path))
              .reduce((s, f) => s + f.tokens_est, 0),
            ...(aliases.length ? { symlink_aliases: aliases } : {}),
          };
        })(),
        pollution: {
          excluded_files: excludedFiles.map((f) => ({ path: f.path, tokens_est: f.tokens_est })),
          excluded_tokens: excludedTokens,
          ratio:
            totalTokens + excludedTokens === 0
              ? 0
              : Number((excludedTokens / (totalTokens + excludedTokens)).toFixed(4)),
          ...(pollutionNote ? { note: pollutionNote } : {}),
        },
        untracked,
      },
      null,
      2
    )}\n`
  );
} catch (err) {
  fail(err.message);
}
