// A launcher that records every filesystem path a script asks about, then runs the script.
//
// It exists for one assertion the JSON output cannot make: links.mjs must classify an out-of-root
// link target **without stat'ing it**, and "the classification came out the same either way" only
// shows the oracle is closed at the output. This shows it at the syscall. The wrapper patches the
// `node:fs` default export before importing the script — both are the same module object, so the
// script's own `fs.existsSync(...)` goes through the recorder.
//
// Usage: node fs-trace.mjs <trace-file> <script> [args...]
// The trace file receives one absolute-or-relative path per line, written on exit (process.exit
// included, which is how fail() ends a run).
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const [traceFile, script, ...rest] = process.argv.slice(2);
if (!traceFile || !script) {
  process.stderr.write('usage: fs-trace.mjs <trace-file> <script> [args...]\n');
  process.exit(2);
}

const seen = [];
const writeTrace = fs.writeFileSync; // captured unpatched, so writing the trace never traces itself

const TRACED = [
  'existsSync', 'statSync', 'lstatSync', 'realpathSync', 'readFileSync',
  'openSync', 'accessSync', 'readdirSync', 'opendirSync', 'readlinkSync',
];

for (const name of TRACED) {
  const orig = fs[name];
  if (typeof orig !== 'function') continue;
  const wrapped = function (p, ...args) {
    if (typeof p === 'string') seen.push(p);
    return orig.call(fs, p, ...args);
  };
  if (orig.native) wrapped.native = orig.native; // fs.realpathSync.native
  fs[name] = wrapped;
}

process.on('exit', () => {
  writeTrace(traceFile, `${seen.join('\n')}\n`);
});

process.argv = [process.argv[0], script, ...rest];
await import(pathToFileURL(script).href);
