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

export type OutputTabId = 'preview' | 'cim' | 'fields' | 'transforms' | 'architecture';

export type PreviewSubTabId = 'raw' | 'highlighted' | 'calculated' | 'diff' | 'timestamp';
