#!/usr/bin/env node
// Read real per-subagent token usage out of Claude Code's own transcripts.
//
// Claude Code writes one JSONL per subagent under
//   ~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<id>.jsonl
// and every assistant line carries the API `usage` block. This script sums those
// blocks per run, matching runs by a tag string embedded in the run's prompt.
//
//   node case-studies/measure/token-usage.mjs --tag-prefix docgrad-cs1
//   node case-studies/measure/token-usage.mjs --dir <subagents-dir> --json
//
// Nothing here is specific to docgrad; it is the measuring stick for case-studies/.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const asJson = argv.includes('--json');
const tagPrefix = arg('--tag-prefix', null);
const explicitDir = arg('--dir', null);

function projectSlug(cwd) {
  return cwd.replace(/[/.]/g, '-');
}

function findSubagentDirs() {
  if (explicitDir) return [explicitDir];
  const root = join(homedir(), '.claude', 'projects', projectSlug(process.cwd()));
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((entry) => join(root, entry, 'subagents'))
    .filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
}

function readRun(file) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const run = {
    file,
    tag: null,
    turns: 0,
    toolCalls: 0,
    input: 0,
    cacheCreate: 0,
    cacheRead: 0,
    output: 0,
    reads: [],
    searches: [],
    started: null,
    ended: null,
  };
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.timestamp) {
      run.started ??= entry.timestamp;
      run.ended = entry.timestamp;
    }
    const content = entry.message?.content;
    if (run.tag === null && typeof content === 'string') {
      const hit = content.match(/RUN-TAG:\s*([\w.-]+)/);
      if (hit) run.tag = hit[1];
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_use') {
          run.toolCalls += 1;
          // Record which files the run actually opened. `Read` names the file directly; the
          // shell and search tools only reveal it through their arguments, so those are recorded
          // as the raw command and left for a human to read.
          const input = block.input || {};
          if (block.name === 'Read' && input.file_path) run.reads.push(input.file_path);
          else if (input.pattern || input.command) {
            run.searches.push(String(input.pattern || input.command).slice(0, 600));
          }
        }
        if (run.tag === null && block.type === 'text') {
          const hit = block.text?.match(/RUN-TAG:\s*([\w.-]+)/);
          if (hit) run.tag = hit[1];
        }
      }
    }
    const usage = entry.message?.usage;
    if (!usage) continue;
    run.turns += 1;
    run.input += usage.input_tokens || 0;
    run.cacheCreate += usage.cache_creation_input_tokens || 0;
    run.cacheRead += usage.cache_read_input_tokens || 0;
    run.output += usage.output_tokens || 0;
  }
  // Tokens that actually entered the model's context for the first time. This is
  // the number a reader should compare across arms: cache_read scales with turn
  // count and prefix size, so it is reported but never used as the headline.
  run.newInput = run.input + run.cacheCreate;
  run.wallSeconds =
    run.started && run.ended
      ? Math.round((Date.parse(run.ended) - Date.parse(run.started)) / 1000)
      : null;
  return run;
}

const runs = findSubagentDirs()
  .flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => readRun(join(dir, f))),
  )
  .filter((run) => (tagPrefix ? run.tag?.startsWith(tagPrefix) : run.tag))
  .sort((a, b) => (a.tag < b.tag ? -1 : 1));

if (asJson) {
  console.log(JSON.stringify(runs, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  console.log(
    `${pad('tag', 22)}${num('turns', 6)}${num('tools', 6)}${num('new-in', 10)}${num('cache-rd', 10)}${num('out', 8)}${num('sec', 6)}`,
  );
  for (const run of runs) {
    console.log(
      `${pad(run.tag, 22)}${num(run.turns, 6)}${num(run.toolCalls, 6)}${num(run.newInput, 10)}${num(run.cacheRead, 10)}${num(run.output, 8)}${num(run.wallSeconds ?? '-', 6)}`,
    );
  }
  if (!runs.length) console.log('(no tagged runs found)');
  if (argv.includes('--files')) {
    for (const run of runs) {
      const counts = new Map();
      for (const f of run.reads) counts.set(f, (counts.get(f) || 0) + 1);
      console.log(`\n${run.tag} — ${run.reads.length} Read calls over ${counts.size} distinct files`);
      for (const [file, n] of [...counts].sort((a, b) => b[1] - a[1])) {
        console.log(`   ${String(n).padStart(2)}x  ${file}`);
      }
      if (run.searches.length) console.log(`   + ${run.searches.length} search/shell calls`);
    }
  }
}
