import { useCallback, useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDebounce } from './useDebounce';
import type { PipelineWorkerRequest, PipelineWorkerResponse } from '../engine/pipelineWorker';

// Vite worker import — bundled as a separate chunk
const createWorker = () =>
  new Worker(new URL('../engine/pipelineWorker.ts', import.meta.url), { type: 'module' });

const WORKER_TIMEOUT_MS = 5_000;
// How many times a single request may restart the worker after a crash before we
// give up. A request that itself crashes the worker (e.g. OOM-sized input) would
// otherwise restart-and-replay forever; cap it so the loop terminates.
const MAX_WORKER_RETRIES = 1;

export function useProcessingPipeline() {
  const rawData = useAppStore((s) => s.rawData);
  const metadata = useAppStore((s) => s.metadata);
  const propsConf = useAppStore((s) => s.propsConf);
  const transformsConf = useAppStore((s) => s.transformsConf);
  const settings = useAppStore((s) => s.settings);
  const manualRunTick = useAppStore((s) => s.manualRunTick);
  const setProcessingResult = useAppStore((s) => s.setProcessingResult);
  const setValidationDiagnostics = useAppStore((s) => s.setValidationDiagnostics);
  const setIsProcessing = useAppStore((s) => s.setIsProcessing);
  const setLastProcessingMs = useAppStore((s) => s.setLastProcessingMs);
  const setPipelineDirty = useAppStore((s) => s.setPipelineDirty);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestRef = useRef<PipelineWorkerRequest | null>(null);
  const requestStartRef = useRef<number>(0);
  const retryCountRef = useRef(0);
  const initWorkerRef = useRef<() => void>(() => {});

  // Arm the 5 s watchdog for a given request id. Pulled out of sendRequest so the
  // crash-retry path can re-arm it too — without this, a hung retry would leave
  // isProcessing stuck true forever. Clears any poisoned request so a later
  // onerror cannot replay something that already timed out.
  const armWatchdog = useCallback((id: number) => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (id !== requestIdRef.current) return;
      timeoutRef.current = null;
      lastRequestRef.current = null; // do not let onerror replay a request that hung
      retryCountRef.current = 0;
      setIsProcessing(false);
      setProcessingResult(null);
      setValidationDiagnostics([{
        level: 'error',
        message: `Pipeline timed out after ${WORKER_TIMEOUT_MS / 1000} s — the input may contain a regex prone to catastrophic backtracking (ReDoS). Try simplifying your EXTRACT or TRANSFORMS pattern.`,
        file: 'props.conf',
      }]);
      workerRef.current?.terminate();
      workerRef.current = null;
      initWorkerRef.current();
    }, WORKER_TIMEOUT_MS);
  }, [setIsProcessing, setProcessingResult, setValidationDiagnostics]);

  // Capture live inputs in a ref so the manual-run effect can read them without being a dependency.
  // Written in an effect (not during render) so the ref only ever reflects committed values.
  const liveInputsRef = useRef({ rawData, metadata, propsConf, transformsConf });
  useEffect(() => {
    liveInputsRef.current = { rawData, metadata, propsConf, transformsConf };
  }, [rawData, metadata, propsConf, transformsConf]);

  const sendRequest = useCallback((
    inputs: { rawData: string; metadata: typeof metadata; propsConf: string; transformsConf: string },
    opts: typeof settings,
  ) => {
    if (!workerRef.current) return;

    const id = ++requestIdRef.current;
    requestStartRef.current = performance.now();
    retryCountRef.current = 0; // a fresh user request starts the retry budget over
    setIsProcessing(true);

    armWatchdog(id);

    const request: PipelineWorkerRequest = {
      id,
      rawData: inputs.rawData,
      metadata: inputs.metadata,
      propsConfText: inputs.propsConf,
      transformsConfText: inputs.transformsConf,
      options: { perEventPipeline: opts.perEventPipeline },
    };

    lastRequestRef.current = request;
    workerRef.current.postMessage(request);
  }, [armWatchdog, setIsProcessing]);

  // Initialise the worker once, with auto-restart on crash
  useEffect(() => {
    function clearWatchdog() {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }

    function initWorker(): Worker {
      const worker = createWorker();
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<PipelineWorkerResponse>) => {
        const { id, result, error } = e.data;
        if (id !== requestIdRef.current) return;

        clearWatchdog();
        setIsProcessing(false);
        setLastProcessingMs(performance.now() - requestStartRef.current);
        // This request completed cleanly — it is not poison, so clear the retry
        // budget and drop it so a later crash cannot replay an already-done request.
        retryCountRef.current = 0;
        lastRequestRef.current = null;

        if (error || !result) {
          setProcessingResult(null);
          setValidationDiagnostics([{
            level: 'error',
            message: `Pipeline error: ${error ?? 'Unknown error'}`,
            file: 'props.conf',
          }]);
          return;
        }

        setProcessingResult(result.result);
        setValidationDiagnostics(result.diagnostics);
      };

      worker.onerror = (e) => {
        clearWatchdog();
        workerRef.current?.terminate();
        workerRef.current = null;
        const restartedWorker = initWorker();

        const pending = lastRequestRef.current;
        if (pending && retryCountRef.current < MAX_WORKER_RETRIES) {
          // Restart once and replay — covers a transient worker crash. The watchdog
          // is re-armed so a retry that also hangs cannot leave isProcessing stuck.
          retryCountRef.current += 1;
          setIsProcessing(true);
          armWatchdog(pending.id);
          restartedWorker.postMessage(pending);
          return;
        }

        // Out of retries (or no pending request): the input itself is crashing the
        // worker. Drop it so we don't loop, and surface a terminal error.
        lastRequestRef.current = null;
        retryCountRef.current = 0;
        setIsProcessing(false);
        setProcessingResult(null);
        setValidationDiagnostics([{
          level: 'error',
          message: pending
            ? `Worker crashed repeatedly while processing this input: ${e.message}. Processing was stopped — try reducing the input size or simplifying your patterns.`
            : `Worker error: ${e.message}`,
          file: 'props.conf',
        }]);
      };

      return worker;
    }

    initWorkerRef.current = initWorker;
    initWorker();

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [armWatchdog, setIsProcessing, setProcessingResult, setValidationDiagnostics, setLastProcessingMs]);

  const inputs = useMemo(
    () => ({ rawData, metadata, propsConf, transformsConf }),
    [rawData, metadata, propsConf, transformsConf],
  );

  const debouncedInputs = useDebounce(inputs, 300);

  // Auto-run effect: fires on debounced input changes when manual apply is OFF.
  useEffect(() => {
    if (settings.manualApply) {
      setPipelineDirty(true);
      return;
    }
    sendRequest(debouncedInputs, settings);
  }, [debouncedInputs, settings, sendRequest, setPipelineDirty]);

  // Manual-run effect: fires when the user clicks "Run pipeline".
  // manualRunTick is only incremented by triggerManualRun() in the store.
  useEffect(() => {
    if (manualRunTick === 0) return; // skip the initial mount
    sendRequest(liveInputsRef.current, settings);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualRunTick]);
}
