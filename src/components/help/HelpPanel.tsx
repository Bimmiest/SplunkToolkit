import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Icon } from '../ui/Icon';

interface PipelineStage {
  step: number;
  name: string;
  phase: 'index-time' | 'search-time';
  description: string;
  directives: string[];
}

const PIPELINE_STAGES: PipelineStage[] = [
  {
    step: 1,
    name: 'Line Breaking',
    phase: 'index-time',
    description:
      'Splits the raw data stream into individual events. Splunk looks for the LINE_BREAKER regex to find event boundaries. By default it breaks on newlines, but multiline events (e.g. stack traces) need SHOULD_LINEMERGE or BREAK_ONLY_BEFORE.',
    directives: ['LINE_BREAKER', 'SHOULD_LINEMERGE', 'BREAK_ONLY_BEFORE', 'BREAK_ONLY_BEFORE_DATE', 'MUST_BREAK_AFTER'],
  },
  {
    step: 2,
    name: 'Truncation',
    phase: 'index-time',
    description:
      'Truncates events that exceed the maximum allowed length. Prevents runaway events from consuming excessive index space. Events are cut at the TRUNCATE byte boundary.',
    directives: ['TRUNCATE'],
  },
  {
    step: 3,
    name: 'Timestamp Extraction',
    phase: 'index-time',
    description:
      'Locates and parses the event timestamp. TIME_PREFIX anchors the search position; TIME_FORMAT parses the found value using strftime tokens. If extraction fails, Splunk falls back to the current time.',
    directives: ['TIME_PREFIX', 'TIME_FORMAT', 'MAX_TIMESTAMP_LOOKAHEAD', 'TZ', 'MAX_DAYS_AGO', 'MAX_DAYS_HENCE'],
  },
  {
    step: 4,
    name: 'Indexed Extractions',
    phase: 'index-time',
    description:
      'Parses structured formats (JSON, CSV, TSV, PSV, W3C) at index time so field values are stored and searchable without search-time extraction overhead. Note: leading underscores are stripped from field names.',
    directives: ['INDEXED_EXTRACTIONS'],
  },
  {
    step: 5,
    name: 'SEDCMD',
    phase: 'index-time',
    description:
      'Applies sed-style s/pattern/replacement/ substitutions to the raw event text before indexing. Commonly used to mask or remove PII (credit cards, SSNs) before the data is persisted.',
    directives: ['SEDCMD'],
  },
  {
    step: 6,
    name: 'Index-Time Transforms',
    phase: 'index-time',
    description:
      'Applies transforms.conf stanzas referenced by TRANSFORMS directives. Can route events to different indexes, modify metadata fields, or drop events entirely before they are written to disk.',
    directives: ['TRANSFORMS', 'INGEST_EVAL'],
  },
  {
    step: 7,
    name: 'Field Extraction',
    phase: 'search-time',
    description:
      'Applies EXTRACT-<name> regex patterns to _raw, using named capture groups to produce fields. All matches are collected — if a regex matches multiple times, the field becomes a multivalue array.',
    directives: ['EXTRACT'],
  },
  {
    step: 8,
    name: 'KV Mode',
    phase: 'search-time',
    description:
      'Automatically extracts fields from structured content in _raw. "auto" handles key=value and key="value" pairs; "json" parses embedded JSON objects; "xml" parses XML; "none" disables auto-extraction.',
    directives: ['KV_MODE', 'AUTO_KV_JSON'],
  },
  {
    step: 9,
    name: 'Search-Time Transforms',
    phase: 'search-time',
    description:
      'Applies transforms.conf stanzas referenced by REPORT directives. Uses REGEX + FORMAT to extract fields at search time, with full support for SOURCE_KEY, DEST_KEY, and multivalue output.',
    directives: ['REPORT'],
  },
  {
    step: 10,
    name: 'Field Aliases',
    phase: 'search-time',
    description:
      'Creates alternative names for existing fields without copying data. Essential for CIM normalisation — map vendor-specific field names (e.g. src_ip) to CIM names (e.g. src) so CIM-based searches work across sourcetypes.',
    directives: ['FIELDALIAS'],
  },
  {
    step: 11,
    name: 'Eval Expressions',
    phase: 'search-time',
    description:
      'Computes new field values using SPL eval expressions at search time. Supports the full eval function library: if(), case(), coalesce(), lower(), tonumber(), strftime(), cidrmatch(), and more.',
    directives: ['EVAL'],
  },
];

const PHASE_LABELS: Record<PipelineStage['phase'], string> = {
  'index-time': 'Index-Time',
  'search-time': 'Search-Time',
};

export function HelpPanel() {
  const helpOpen = useAppStore((s) => s.helpOpen);
  const toggleHelp = useAppStore((s) => s.toggleHelp);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  // Close on Escape
  useEffect(() => {
    if (!helpOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleHelp();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [helpOpen, toggleHelp]);

  const indexStages = PIPELINE_STAGES.filter((s) => s.phase === 'index-time');
  const searchStages = PIPELINE_STAGES.filter((s) => s.phase === 'search-time');

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-200"
        style={{
          backgroundColor: 'rgba(0,0,0,0.3)',
          opacity: helpOpen ? 1 : 0,
          pointerEvents: helpOpen ? 'auto' : 'none',
        }}
        onClick={toggleHelp}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Pipeline reference"
        aria-modal="true"
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col w-[420px] max-w-full shadow-2xl transition-transform duration-250 ease-in-out"
        style={{
          backgroundColor: 'var(--color-bg-primary)',
          borderLeft: '1px solid var(--color-border)',
          transform: helpOpen ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0 border-b"
          style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-bg-secondary)' }}
        >
          <div className="flex items-center gap-2">
            <Icon name="settings" className="w-4 h-4 text-[var(--color-accent)]" />
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Pipeline Reference</h2>
          </div>
          <button
            onClick={toggleHelp}
            aria-label="Close panel"
            className="flex items-center justify-center w-7 h-7 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] transition-colors border-none bg-transparent cursor-pointer"
          >
            <Icon name="x" className="w-4 h-4" />
          </button>
        </div>

        {/* Intro */}
        <div className="px-5 py-3 shrink-0 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            Splunk processes events in a fixed order. Index-time processors run when data is ingested;
            search-time processors run at query time. Click any stage to see which directives control it.
          </p>
        </div>

        {/* Stages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          <StageGroup
            title="Index-Time Processing"
            stages={indexStages}
            phaseColor="var(--color-warning)"
            expandedStep={expandedStep}
            onToggle={setExpandedStep}
          />
          <StageGroup
            title="Search-Time Processing"
            stages={searchStages}
            phaseColor="var(--color-accent)"
            expandedStep={expandedStep}
            onToggle={setExpandedStep}
          />
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 shrink-0 border-t text-xs text-[var(--color-text-muted)]"
          style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-bg-secondary)' }}
        >
          Hover any directive key in the editor for full docs and examples.
        </div>
      </div>
    </>
  );
}

function StageGroup({
  title,
  stages,
  phaseColor,
  expandedStep,
  onToggle,
}: {
  title: string;
  stages: PipelineStage[];
  phaseColor: string;
  expandedStep: number | null;
  onToggle: (step: number | null) => void;
}) {
  return (
    <div>
      <p
        className="text-[11px] font-semibold uppercase tracking-wider mb-2"
        style={{ color: phaseColor }}
      >
        {title}
      </p>
      <div className="space-y-1.5">
        {stages.map((stage) => (
          <StageCard
            key={stage.step}
            stage={stage}
            phaseColor={phaseColor}
            isExpanded={expandedStep === stage.step}
            onToggle={() => onToggle(expandedStep === stage.step ? null : stage.step)}
          />
        ))}
      </div>
    </div>
  );
}

function StageCard({
  stage,
  phaseColor,
  isExpanded,
  onToggle,
}: {
  stage: PipelineStage;
  phaseColor: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="rounded-lg border overflow-hidden transition-colors"
      style={{
        borderColor: isExpanded ? phaseColor + '60' : 'var(--color-border-subtle)',
        backgroundColor: 'var(--color-bg-elevated)',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer bg-transparent border-none transition-colors hover:bg-[var(--color-bg-secondary)]"
      >
        {/* Step badge */}
        <div
          className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
          style={{ backgroundColor: phaseColor + '20', color: phaseColor }}
        >
          {stage.step}
        </div>

        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-[var(--color-text-primary)]">{stage.name}</span>
          <span
            className="ml-2 text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ backgroundColor: phaseColor + '15', color: phaseColor }}
          >
            {PHASE_LABELS[stage.phase]}
          </span>
        </div>

        <Icon
          name="chevron-down"
          className={`shrink-0 w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform duration-150 ${isExpanded ? '' : '-rotate-90'}`}
        />
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-3">
            {stage.description}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {stage.directives.map((d) => (
              <span
                key={d}
                className="px-2 py-0.5 text-[11px] font-mono rounded-md font-medium"
                style={{
                  backgroundColor: 'var(--color-bg-secondary)',
                  color: 'var(--color-accent)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
