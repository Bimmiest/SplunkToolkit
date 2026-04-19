import { useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDebounce } from './useDebounce';
import type { PipelineWorkerRequest, PipelineWorkerResponse } from '../engine/pipelineWorker';

// Vite worker import — bundled as a separate chunk
const createWorker = () =>
  new Worker(new URL('../engine/pipelineWorker.ts', import.meta.url), { type: 'module' });

const WORKER_TIMEOUT_MS = 5_000;

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
  const initWorkerRef = useRef<() => void>(() => {});

  // Capture live inputs in a ref so the manual-run effect can read them without being a dependency.
  const liveInputsRef = useRef({ rawData, metadata, propsConf, transformsConf });
  liveInputsRef.current = { rawData, metadata, propsConf, transformsConf };

  const sendRequest = useRef((
    inputs: { rawData: string; metadata: typeof metadata; propsConf: string; transformsConf: string },
    opts: typeof settings,
  ) => {
    if (!workerRef.current) return;

    const id = ++requestIdRef.current;
    requestStartRef.current = performance.now();
    setIsProcessing(true);

    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (id !== requestIdRef.current) return;
      timeoutRef.current = null;
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
  }).current;

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
        setIsProcessing(false);
        setProcessingResult(null);
        setValidationDiagnostics([{
          level: 'error',
          message: `Worker error: ${e.message}`,
          file: 'props.conf',
        }]);
        workerRef.current?.terminate();
        workerRef.current = null;
        const restartedWorker = initWorker();
        const pending = lastRequestRef.current;
        if (pending) {
          setIsProcessing(true);
          restartedWorker.postMessage(pending);
        }
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
  }, [setIsProcessing, setProcessingResult, setValidationDiagnostics, setLastProcessingMs]);

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
