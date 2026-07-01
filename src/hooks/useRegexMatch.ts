import { useEffect, useRef, useState } from 'react';
import { useDebounce } from './useDebounce';
import { matchInputs } from '../engine/regexMatch';
import type { RegexMatchInfo } from '../engine/regexMatch';
import type { RegexMatchRequest, RegexMatchResponse } from '../engine/regexMatchWorker';

const createWorker = () =>
  new Worker(new URL('../engine/regexMatchWorker.ts', import.meta.url), { type: 'module' });

// Shorter than the main pipeline's 5 s: the live tester runs on every keystroke,
// so a runaway pattern should be cut quickly. A catastrophic regex hangs the
// worker (not the UI), and this watchdog terminates and restarts it.
const REGEX_TIMEOUT_MS = 2_000;

export type RegexMatchStatus = 'idle' | 'pending' | 'ok' | 'timeout' | 'invalid';

export interface RegexMatchState {
  status: RegexMatchStatus;
  /** Per-input match info aligned to `inputs`; empty unless status is 'ok'. */
  results: (RegexMatchInfo | null)[];
}

/**
 * Match a Splunk regex against many inputs in a terminatable Web Worker.
 *
 * Unlike a synchronous `regex.exec` on the main thread, a catastrophic pattern
 * that slips the ReDoS heuristic only hangs the worker — the watchdog kills it,
 * restarts it, and reports `timeout`, so the Regex tab stays responsive.
 *
 * Where `Worker` is unavailable (tests / SSR) it falls back to matching on the
 * calling thread; the browser always has a worker and uses the safe path.
 *
 * `inputs` must be referentially stable (memoise it in the caller) so a match is
 * only re-run when the pattern or the events actually change.
 */
export function useRegexMatch(pattern: string, inputs: string[]): RegexMatchState {
  const [status, setStatus] = useState<RegexMatchStatus>('idle');
  const [results, setResults] = useState<(RegexMatchInfo | null)[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Assigned inside the setup effect (never during render) so calling it from the
  // trigger effect keeps setState off the render path and refs off render reads.
  const runRef = useRef<(pattern: string, inputs: string[]) => void>(() => {});

  const debouncedPattern = useDebounce(pattern, 250);

  useEffect(() => {
    function clearTimer() {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }

    function init() {
      if (typeof Worker === 'undefined') {
        workerRef.current = null;
        return;
      }
      let worker: Worker;
      try {
        worker = createWorker();
      } catch {
        workerRef.current = null; // fall back to inline matching
        return;
      }
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<RegexMatchResponse>) => {
        if (e.data.id !== idRef.current) return; // stale response
        clearTimer();
        if (e.data.results === null) {
          setStatus('invalid');
          setResults([]);
        } else {
          setStatus('ok');
          setResults(e.data.results);
        }
      };

      worker.onerror = () => {
        // The worker died mid-match (e.g. a runaway pattern). Terminate, restart,
        // and surface it like a timeout so the tab recovers.
        clearTimer();
        workerRef.current?.terminate();
        init();
        setStatus('timeout');
        setResults([]);
      };
    }

    runRef.current = (pat: string, inp: string[]) => {
      clearTimer();

      if (!pat) {
        setStatus('idle');
        setResults([]);
        return;
      }

      const id = ++idRef.current;

      // No worker (tests / SSR, or worker construction failed): match inline. Only
      // heuristic-safe patterns reach here in practice.
      if (workerRef.current === null) {
        const out = matchInputs(pat, inp);
        setStatus(out === null ? 'invalid' : 'ok');
        setResults(out ?? []);
        return;
      }

      setStatus('pending');
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        // Too slow — a catastrophic pattern has hung the worker. Kill and restart
        // it so the next keystroke gets a fresh one.
        workerRef.current?.terminate();
        init();
        setStatus('timeout');
        setResults([]);
      }, REGEX_TIMEOUT_MS);

      const request: RegexMatchRequest = { id, pattern: pat, inputs: inp };
      workerRef.current.postMessage(request);
    };

    init();

    return () => {
      clearTimer();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    runRef.current(debouncedPattern, inputs);
  }, [debouncedPattern, inputs]);

  return { status, results };
}
