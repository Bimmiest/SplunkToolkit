/**
 * Message shapes between the server process and the sandbox worker.
 *
 * Every operation that EXECUTES conf-derived regexes — simulate (the full
 * pipeline), validate (a pipeline run over a dummy sample to surface the
 * config-level diagnostics), explain (stanza matching runs `[source::…]` /
 * `[host::…]` patterns) — crosses this boundary and runs inside a worker
 * thread the parent can terminate. Only `lookup_directive`, which reads the
 * static registry and executes nothing, stays in-process.
 */
import type {
  ConfInput,
  EventMetadata,
  ProcessingResult,
  ValidationDiagnostic,
} from '../../../src/engine/types';

export interface SimulateRequest {
  op: 'simulate';
  raw: string;
  metadata: EventMetadata;
  propsConf: ConfInput;
  transformsConf: ConfInput;
  perEventPipeline: boolean;
  captureOffsets: boolean;
}

export interface ValidateRequest {
  op: 'validate';
  propsConf: ConfInput;
  transformsConf: ConfInput;
}

export interface ExplainRequest {
  op: 'explain';
  file: 'props.conf' | 'transforms.conf';
  conf: ConfInput;
  /** When present (props.conf only), also resolve stanzas for this event. */
  metadata?: EventMetadata;
}

export type WorkerRequest = SimulateRequest | ValidateRequest | ExplainRequest;

export interface SimulateResponse {
  result: ProcessingResult;
  diagnostics: ValidationDiagnostic[];
}

export interface ValidateResponse {
  diagnostics: ValidationDiagnostic[];
}

/** One directive of a stanza, with the layer provenance parseConf attached. */
export interface ExplainDirective {
  key: string;
  value: string;
  line: number;
  layer?: string;
  overrides?: { layer: string; line: number; value: string }[];
  overriddenBy?: { layer: string; line: number; value: string };
}

export interface ExplainStanza {
  name: string;
  type: 'sourcetype' | 'source' | 'host' | 'default';
  lineRange: { start: number; end: number };
  layer?: string;
  layers?: { layer: string; lineRange: { start: number; end: number } }[];
  directives: ExplainDirective[];
}

export interface ExplainResponse {
  parseErrors: ValidationDiagnostic[];
  stanzas: ExplainStanza[];
  /** Present only for props.conf when event metadata was supplied. */
  resolution?: {
    metadata: EventMetadata;
    effectiveMetadata: EventMetadata;
    assignedSourcetype?: string;
    /** Highest precedence first — the order `mergeDirectives` consumes. */
    matchedStanzas: { name: string; type: ExplainStanza['type']; layer?: string }[];
    /** The attribute set the event is actually processed with. */
    effectiveDirectives: (ExplainDirective & { stanza: string })[];
  };
}

export type WorkerResponse =
  | { ok: true; data: SimulateResponse | ValidateResponse | ExplainResponse }
  | { ok: false; error: string };
