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
  fieldsModified?: string[];
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
}

export interface ProcessingResult {
  events: SplunkEvent[];
  originalRaw: string;
  eventCount: number;
  processingSteps: ProcessingStep[];
}

export type DiagnosticLevel = 'error' | 'warning' | 'info';

export interface ValidationDiagnostic {
  level: DiagnosticLevel;
  message: string;
  file: 'props.conf' | 'transforms.conf';
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
