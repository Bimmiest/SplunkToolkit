import { useEffect, useRef, useState } from 'react';
import { probeTimestamps } from '../engine/timestampMatch';
import type { TimeConfig, TimestampProbe } from '../engine/timestampMatch';
import type { TimestampMatchRequest, TimestampMatchResponse } from '../engine/timestampMatchWorker';

const createWorker = () =>
  new Worker(new URL('../engine/timestampMatchWorker.ts', import.meta.url), { type: 'module' });

// Matches the Regex tab's tester: this re-runs whenever props.conf changes, so a
// runaway TIME_PREFIX should be cut quickly rather than held for the pipeline's 5 s.
const TIMESTAMP_TIMEOUT_MS = 2_000;

export type TimestampMatchStatus = 'idle' | 'pending' | 'ok' | 'timeout';

export interface TimestampMatchState {
  status: TimestampMatchStatus;
  /** Per-event probes aligned to `raws`; empty unless status is 'ok'. */
  probes: TimestampProbe[];
}

/**
 * Probe events for their timestamp in a terminatable Web Worker.
 *
 * TIME_PREFIX is a user-supplied regex, and `safeRegex`'s heuristic is explicit
 * that it does not catch alternation-overlap forms. Executed synchronously in a
 * `useMemo` on the render path there was nothing to terminate — a permitted but
 * ambiguous pattern froze the tab for tens of seconds with no diagnostic. Here it
 * only hangs the worker, which the watchdog kills and restarts.
 *
 * Where `Worker` is unavailable (tests / SSR) it falls back to probing on the
 * calling thread; the browser always has a worker and uses the safe path.
 *
 * `raws` must be referentially stable (memoise it in the caller) so a probe only
 * re-runs when the events or the config actually change.
 */
export function useTimestampMatch(raws: string[], config: TimeConfig): TimestampMatchState {
  const [status, setStatus] = useState<TimestampMatchStatus>('idle');
  const [probes, setProbes] = useState<TimestampProbe[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Assigned inside the setup effect (never during render) so calling it from the
  // trigger effect keeps setState off the render path and refs off render reads.
  const runRef = useRef<(raws: string[], config: TimeConfig) => void>(() => {});

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
        workerRef.current = null; // fall back to inline probing
        return;
      }
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<TimestampMatchResponse>) => {
        if (e.data.id !== idRef.current) return; // stale response
        clearTimer();
        setStatus('ok');
        setProbes(e.data.probes);
      };

      worker.onerror = () => {
        // The worker died mid-probe (e.g. a runaway pattern). Terminate, restart,
        // and surface it like a timeout so the tab recovers.
        clearTimer();
        workerRef.current?.terminate();
        init();
        setStatus('timeout');
        setProbes([]);
      };
    }

    runRef.current = (nextRaws: string[], nextConfig: TimeConfig) => {
      clearTimer();

      if (nextRaws.length === 0) {
        setStatus('idle');
        setProbes([]);
        return;
      }

      const id = ++idRef.current;

      // No worker (tests / SSR, or worker construction failed): probe inline.
      if (workerRef.current === null) {
        setStatus('ok');
        setProbes(probeTimestamps(nextRaws, nextConfig));
        return;
      }

      setStatus('pending');
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        // Too slow — a catastrophic TIME_PREFIX has hung the worker. Kill and
        // restart it so the next edit gets a fresh one.
        workerRef.current?.terminate();
        init();
        setStatus('timeout');
        setProbes([]);
      }, TIMESTAMP_TIMEOUT_MS);

      const request: TimestampMatchRequest = { id, raws: nextRaws, config: nextConfig };
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
    runRef.current(raws, config);
  }, [raws, config]);

  return { status, probes };
}
