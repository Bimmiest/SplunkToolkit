/**
 * Web Worker entry point for the Regex-tab live tester.
 *
 * Runs user-supplied regex matching off the main thread so a catastrophic
 * pattern that slips the ReDoS heuristic hangs THIS worker (which the caller
 * terminates via a watchdog) instead of freezing the UI tab.
 *
 * Message protocol:
 *   in  → RegexMatchRequest
 *   out → RegexMatchResponse
 */

import { matchInputs } from './regexMatch';
import type { RegexMatchInfo } from './regexMatch';

export interface RegexMatchRequest {
  id: number;
  pattern: string;
  inputs: string[];
}

export interface RegexMatchResponse {
  id: number;
  /** Per-input results, or null when the pattern is invalid / ReDoS-refused. */
  results: (RegexMatchInfo | null)[] | null;
}

self.onmessage = (e: MessageEvent<RegexMatchRequest>) => {
  const { id, pattern, inputs } = e.data;
  const results = matchInputs(pattern, inputs);
  const response: RegexMatchResponse = { id, results };
  self.postMessage(response);
};
