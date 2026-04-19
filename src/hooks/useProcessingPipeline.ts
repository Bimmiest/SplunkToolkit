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
  const setProcessingResult = useAppStore((s) => s.setProcessingResult);
  const setValidationDiagnostics = useAppStore((s) => s.setValidationDiagnostics);
  const setIsProcessing = useAppStore((s) => s.setIsProcessing);
  const setLastProcessingMs = useAppStore((s) => s.setLastProcessingMs);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestRef = useRef<PipelineWorkerRequest | null>(null);
  const requestStartRef = useRef<number>(0);
  // Stable ref to initWorker so it can be called from the send effect and the timeout
  const initWorkerRef = useRef<() => void>(() => {});

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
        // Ignore stale responses from superseded requests
        if (id !== requestIdRef.current) return;

        clearWatchdog();
        setIsProcessing(false);
        setLastProcessingMs(performance.now() - requestStartRef.current);

        if (error || !result) {
          setProcessingResult(null);
          setValidationDiagnostics([
            {
              level: 'error',
              message: `Pipeline error: ${error ?? 'Unknown error'}`,
              file: 'props.conf',
            },
          ]);
          return;
        }

        setProcessingResult(result.result);
        setValidationDiagnostics(result.diagnostics);
      };

      worker.onerror = (e) => {
        clearWatchdog();
        setIsProcessing(false);
        setProcessingResult(null);
        setValidationDiagnostics([
          {
            level: 'error',
            message: `Worker error: ${e.message}`,
            file: 'props.conf',
          },
        ]);
        // Restart so subsequent inputs can still be processed, then replay the
        // last in-flight request so the user doesn't need to manually re-trigger.
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

  useEffect(() => {
    if (!workerRef.current) return;

    const id = ++requestIdRef.current;
    requestStartRef.current = performance.now();
    setIsProcessing(true);

    // Cancel any previous watchdog before arming a new one
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      if (id !== requestIdRef.current) return;
      timeoutRef.current = null;
      setIsProcessing(false);
      setProcessingResult(null);
      setValidationDiagnostics([
        {
          level: 'error',
          message: `Pipeline timed out after ${WORKER_TIMEOUT_MS / 1000} s — the input may contain a regex prone to catastrophic backtracking (ReDoS). Try simplifying your EXTRACT or TRANSFORMS pattern.`,
          file: 'props.conf',
        },
      ]);
      workerRef.current?.terminate();
      workerRef.current = null;
      initWorkerRef.current();
    }, WORKER_TIMEOUT_MS);

    const request: PipelineWorkerRequest = {
      id,
      rawData: debouncedInputs.rawData,
      metadata: debouncedInputs.metadata,
      propsConfText: debouncedInputs.propsConf,
      transformsConfText: debouncedInputs.transformsConf,
    };

    lastRequestRef.current = request;
    workerRef.current.postMessage(request);
  }, [debouncedInputs, setIsProcessing, setProcessingResult, setValidationDiagnostics]);
}
