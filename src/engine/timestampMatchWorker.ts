/**
 * Web Worker entry point for the Timestamp tab's live prober.
 *
 * Runs the user's TIME_PREFIX off the main thread so a catastrophic pattern that
 * slips the ReDoS heuristic hangs THIS worker — which the caller terminates via
 * a watchdog — instead of freezing the tab while someone is editing props.conf.
 *
 * Message protocol:
 *   in  → TimestampMatchRequest
 *   out → TimestampMatchResponse
 */

import { probeTimestamps } from './timestampMatch';
import type { TimeConfig, TimestampProbe } from './timestampMatch';

export interface TimestampMatchRequest {
  id: number;
  raws: string[];
  config: TimeConfig;
}

export interface TimestampMatchResponse {
  id: number;
  /** Per-input probes, aligned to `raws`. */
  probes: TimestampProbe[];
}

self.onmessage = (e: MessageEvent<TimestampMatchRequest>) => {
  const { id, raws, config } = e.data;
  const response: TimestampMatchResponse = { id, probes: probeTimestamps(raws, config) };
  self.postMessage(response);
};
