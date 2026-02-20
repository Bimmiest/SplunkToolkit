import { useEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDebounce } from './useDebounce';
import { runPipeline } from '../engine/pipeline';

export function useProcessingPipeline() {
  const rawData = useAppStore((s) => s.rawData);
  const metadata = useAppStore((s) => s.metadata);
  const propsConf = useAppStore((s) => s.propsConf);
  const transformsConf = useAppStore((s) => s.transformsConf);
  const setProcessingResult = useAppStore((s) => s.setProcessingResult);
  const setValidationDiagnostics = useAppStore((s) => s.setValidationDiagnostics);

  const inputs = useMemo(
    () => ({ rawData, metadata, propsConf, transformsConf }),
    [rawData, metadata, propsConf, transformsConf]
  );

  const debouncedInputs = useDebounce(inputs, 300);

  useEffect(() => {
    try {
      const { result, diagnostics } = runPipeline(
        debouncedInputs.rawData,
        debouncedInputs.metadata,
        debouncedInputs.propsConf,
        debouncedInputs.transformsConf
      );
      setProcessingResult(result);
      setValidationDiagnostics(diagnostics);
    } catch (err) {
      console.error('Pipeline error:', err);
      setProcessingResult(null);
      setValidationDiagnostics([
        {
          level: 'error',
          message: `Pipeline error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          file: 'props.conf',
        },
      ]);
    }
  }, [debouncedInputs, setProcessingResult, setValidationDiagnostics]);
}
