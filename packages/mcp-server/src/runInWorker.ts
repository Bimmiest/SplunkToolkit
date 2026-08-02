/**
 * Runs one engine operation in a worker thread under a wall-clock budget.
 *
 * This is the primary defence docs/engine.md requires of a consumer executing
 * conf-derived regexes it did not write: a thread the parent can TERMINATE.
 * The V8 linear-time-fallback flags (see `v8Flags.ts`) are the second layer —
 * they lower how often this watchdog fires, but a lookahead or backreference
 * declines the fallback, so termination is the mechanism, never the flags.
 *
 * A fresh worker per call costs a few tens of milliseconds and buys two
 * properties worth far more here: `terminate()` cannot leave a half-poisoned
 * reusable worker behind, and no state crosses from one tool call to the next.
 */
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { WorkerRequest, WorkerResponse } from './protocol';

export class WorkerTimeoutError extends Error {
  readonly budgetMs: number;
  constructor(budgetMs: number) {
    super(`Worker exceeded its ${budgetMs}ms wall-clock budget and was terminated`);
    this.name = 'WorkerTimeoutError';
    this.budgetMs = budgetMs;
  }
}

export function runInWorker<T>(
  request: WorkerRequest,
  timeoutMs: number,
  workerPath?: string,
): Promise<T> {
  // Resolved lazily: in the esbuild CJS bundle `__dirname` is the dist
  // directory and the worker is the sibling bundle; tests running from source
  // pass the built worker's path explicitly.
  const resolvedPath = workerPath ?? path.join(__dirname, 'simulateWorker.js');

  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(resolvedPath, { workerData: request });
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new WorkerTimeoutError(timeoutMs));
    }, timeoutMs);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      void worker.terminate();
    };

    worker.once('message', (response: WorkerResponse) => {
      settle(() => {
        if (response.ok) resolve(response.data as T);
        else reject(new Error(response.error));
      });
    });
    worker.once('error', (err) =>
      settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
    );
    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Worker exited with code ${code} before responding`));
    });
  });
}
