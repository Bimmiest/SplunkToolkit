/**
 * Second-layer mitigation for catastrophic regex backtracking, per
 * docs/engine.md: let V8 abandon a backtracking match and finish on its
 * linear-time engine. The PRIMARY mechanism is the terminatable worker with a
 * wall-clock budget in `runInWorker.ts` — these flags only lower how often the
 * watchdog fires, because a pattern carrying a lookahead or backreference
 * declines the fallback entirely.
 *
 * The launcher (`index.ts`) re-execs node with these as real CLI flags, which
 * is the documented, guaranteed way to set them before anything compiles a
 * regex. `setFlagsFromString` here is the fallback for embedders that import
 * the server without the launcher (tests, programmatic use): it must run
 * before the engine modules load, which is why every entry point imports this
 * module FIRST — ESM evaluates imports in declaration order, so this module
 * body finishes before the engine's top-level regexes compile.
 */
import v8 from 'node:v8';

export const REGEXP_FALLBACK_FLAGS = [
  '--enable-experimental-regexp-engine-on-excessive-backtracks',
  '--regexp-backtracks-before-fallback=1000',
];

export function flagsAlreadySet(): boolean {
  return process.execArgv.includes(REGEXP_FALLBACK_FLAGS[0]);
}

if (!flagsAlreadySet()) {
  for (const flag of REGEXP_FALLBACK_FLAGS) {
    v8.setFlagsFromString(flag);
  }
}
