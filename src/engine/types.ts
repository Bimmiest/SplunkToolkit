export interface EventMetadata {
  index: string;
  host: string;
  source: string;
  sourcetype: string;
}

export interface ProcessingStep {
  processor: string;
  phase: 'index-time' | 'search-time';
  description: string;
  inputSnapshot?: string;
  outputSnapshot?: string;
  fieldsAdded?: string[];
  /**
   * Fields that still extract after this step but whose value changed — the
   * signature of a mask rule eating a value that an extraction does find.
   * Populated for steps that rewrite `_raw` (SEDCMD, DEST_KEY = _raw) by
   * `attributeRawMutations`, which runs after search-time extraction.
   */
  fieldsModified?: string[];
  /**
   * Fields that extracted from the pre-step `_raw` and no longer extract at all
   * — the step deleted the text the extraction anchors on. Distinct from
   * `fieldsModified`: the remedy differs (the extraction is broken, not just
   * devalued), so the two are never merged.
   */
  fieldsRemoved?: string[];
}

/**
 * A single in-place rewrite of `_raw`, recorded at index time so the fields it
 * affected can be attributed after search-time extraction has run.
 *
 * SEDCMD and DEST_KEY = _raw are text substitutions: they have no field
 * parameter and cannot name what they changed. The association only exists by
 * comparison, and the extraction rules needed to compute it do not run until
 * later in the pipeline — hence this transient record rather than an
 * attribution made at the point of the edit.
 */
export interface RawMutation {
  /** Index into the event's `processingTrace` of the step to backfill. */
  traceIndex: number;
  rawBefore: string;
  rawAfter: string;
}

export interface SplunkEvent {
  _raw: string;
  _time: Date | null;
  _meta: Record<string, string>;
  fields: Record<string, string | string[]>;
  /**
   * Maps stripped field name → original raw key when underscore-stripping occurred
   * during INDEXED_EXTRACTIONS. Used by the highlighter to locate the value in _raw
   * using the un-stripped key for context-aware matching.
   * e.g. { 'GID': '_GID', 'AUDIT_SESSION': '_AUDIT_SESSION' }
   */
  fieldSourceKeys?: Record<string, string>;
  /**
   * Authoritative start/end offsets in `_raw` for fields extracted by position.
   * Populated by EXTRACT-* against `_raw`. When present, the highlighter uses
   * these offsets directly instead of searching `_raw` with context patterns,
   * preventing double-highlight / wrong-occurrence bugs for positional captures
   * against unstructured text (e.g. access logs).
   */
  fieldOffsets?: Record<string, Array<[number, number]>>;
  metadata: EventMetadata;
  lineNumbers: { start: number; end: number };
  processingTrace: ProcessingStep[];
  /**
   * Transient: every index-time rewrite of `_raw`, consumed and stripped by
   * `attributeRawMutations` at the end of the pipeline. Never present on the
   * events a caller receives.
   */
  rawMutations?: RawMutation[];
}

export interface ProcessingResult {
  events: SplunkEvent[];
  originalRaw: string;
  eventCount: number;
  processingSteps: ProcessingStep[];
}

export type DiagnosticLevel = 'error' | 'warning' | 'info';

/**
 * Which panel a diagnostic belongs to. `props.conf`/`transforms.conf` are config
 * problems shown under their editors; `raw` is a data-quality problem (e.g. an
 * event that isn't valid JSON) shown under the Raw Log panel, with `line` pointing
 * at the offending input line rather than a config line.
 */
export type DiagnosticTarget = 'props.conf' | 'transforms.conf' | 'raw';

export interface ValidationDiagnostic {
  level: DiagnosticLevel;
  message: string;
  file: DiagnosticTarget;
  line?: number;
  column?: number;
  directiveKey?: string;
  suggestion?: string;
}

export interface ConfDirective {
  key: string;
  value: string;
  line: number;
  directiveType: string;
  className?: string;
}

export interface ConfStanza {
  name: string;
  type: 'sourcetype' | 'source' | 'host' | 'default';
  sourcePattern?: string;
  hostPattern?: string;
  directives: ConfDirective[];
  lineRange: { start: number; end: number };
}

export interface ParsedConf {
  stanzas: ConfStanza[];
  errors: ValidationDiagnostic[];
}

export interface PipelineOptions {
  perEventPipeline: boolean;
}

export type OutputTabId = 'preview' | 'cim' | 'fields' | 'transforms' | 'architecture';

export type PreviewSubTabId = 'raw' | 'highlighted' | 'diff' | 'timestamp' | 'regex';
