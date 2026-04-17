/**
 * Web Worker entry point for the Splunk processing pipeline.
 *
 * Runs runPipeline() off the main thread so the UI stays responsive
 * even for large inputs or expensive regex transforms.
 *
 * Message protocol:
 *   in  → PipelineWorkerRequest
 *   out → PipelineWorkerResponse
 */

import { runPipeline } from './pipeline';
import type { EventMetadata } from './types';

export interface PipelineWorkerRequest {
  id: number;
  rawData: string;
  metadata: EventMetadata;
  propsConfText: string;
  transformsConfText: string;
}

export interface PipelineWorkerResponse {
  id: number;
  result: ReturnType<typeof runPipeline> | null;
  error?: string;
}

self.onmessage = (e: MessageEvent<PipelineWorkerRequest>) => {
  const { id, rawData, metadata, propsConfText, transformsConfText } = e.data;
  try {
    const output = runPipeline(rawData, metadata, propsConfText, transformsConfText);
    const response: PipelineWorkerResponse = { id, result: output };
    self.postMessage(response);
  } catch (err) {
    const response: PipelineWorkerResponse = {
      id,
      result: null,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
