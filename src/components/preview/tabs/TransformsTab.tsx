import { useMemo } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { Icon } from '../../ui/Icon';
import { Tooltip } from '../../ui/Tooltip';

interface StepSummary {
  processor: string;
  phase: 'index-time' | 'search-time';
  /** Distinct per-event descriptions, in first-seen order. */
  descriptions: string[];
  eventsAffected: number;
  totalEvents: number;
  fieldsAdded: string[];
}

// Strip a trailing "(…)" detail (e.g. "(lines 1-1)") so per-event variants of an
// index-time step collapse to one representative summary line.
const stripDetail = (d: string) => d.replace(/\s*\([^)]*\)\s*$/, '');

export function TransformsTab() {
  const result = useAppStore((s) => s.processingResult);

  const summary = useMemo(() => {
    if (!result) return { indexTime: [] as StepSummary[], searchTime: [] as StepSummary[] };

    const totalEvents = result.events.length;
    // Group by processor (not processor+description) so index-time steps with
    // per-event descriptions collapse into one row per processor, consistent with
    // the search-time section. Distinct event count and per-event detail are kept.
    const stepMap = new Map<string, StepSummary & { events: Set<number> }>();

    result.events.forEach((event, eventIdx) => {
      for (const step of event.processingTrace) {
        let entry = stepMap.get(step.processor);
        if (!entry) {
          entry = {
            processor: step.processor,
            phase: step.phase,
            descriptions: [],
            eventsAffected: 0,
            totalEvents,
            fieldsAdded: [],
            events: new Set<number>(),
          };
          stepMap.set(step.processor, entry);
        }
        entry.events.add(eventIdx);
        if (!entry.descriptions.includes(step.description)) entry.descriptions.push(step.description);
        for (const f of step.fieldsAdded ?? []) {
          if (!entry.fieldsAdded.includes(f)) entry.fieldsAdded.push(f);
        }
      }
    });

    const indexTime: StepSummary[] = [];
    const searchTime: StepSummary[] = [];
    for (const { events, ...s } of stepMap.values()) {
      const step: StepSummary = { ...s, eventsAffected: events.size };
      if (step.phase === 'index-time') indexTime.push(step);
      else searchTime.push(step);
    }

    return { indexTime, searchTime };
  }, [result]);

  return (
    <div className="h-full overflow-auto p-3 space-y-4">
      {result && (
        <div className="text-xs text-[var(--color-text-muted)] mb-2">
          Pipeline processed {result.eventCount} event{result.eventCount !== 1 ? 's' : ''} through {summary.indexTime.length + summary.searchTime.length} unique steps
        </div>
      )}

      <StepSection title="Index-Time Processing" steps={summary.indexTime} phaseColor="var(--color-warning)" />
      <StepSection title="Search-Time Processing" steps={summary.searchTime} phaseColor="var(--color-accent)" />

      {summary.indexTime.length === 0 && summary.searchTime.length === 0 && (
        <div className="text-center text-[var(--color-text-muted)] text-sm py-8">
          No transforms applied yet
        </div>
      )}
    </div>
  );
}

const PHASE_HINTS: Record<string, string> = {
  'Index-Time Processing': 'Runs at ingest time — LINE_BREAKER, timestamps, SEDCMD, TRANSFORMS, INGEST_EVAL. Results are stored in the index.',
  'Search-Time Processing': 'Runs at query time — EXTRACT, KV_MODE, REPORT, FIELDALIAS, EVAL. Results are computed fresh for each search.',
};

function StepSection({ title, steps, phaseColor }: { title: string; steps: StepSummary[]; phaseColor: string }) {
  if (steps.length === 0) return null;

  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: phaseColor }}>
        {title} ({steps.length} step{steps.length !== 1 ? 's' : ''})
        <Tooltip content={PHASE_HINTS[title]} side="right">
          <button type="button" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors p-0 border-none bg-transparent cursor-default opacity-70 hover:opacity-100">
            <Icon name="info" className="w-3 h-3" />
          </button>
        </Tooltip>
      </h3>
      <div className="space-y-1">
        {steps.map((step, idx) => (
          <div
            key={idx}
            className="flex items-start gap-3 px-3 py-2.5 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border)] transition-colors"
          >
            <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: phaseColor + '20', color: phaseColor }}>
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-semibold text-[var(--color-text-primary)]">
                  {step.processor}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  ({step.eventsAffected}/{step.totalEvents} events)
                </span>
              </div>
              {(() => {
                const reps = [...new Set(step.descriptions.map(stripDetail))];
                const summaryText = reps.length === 1 ? reps[0] : step.descriptions[0];
                return (
                  <>
                    <div className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                      {summaryText}
                    </div>
                    {step.descriptions.length > 1 && (
                      <details className="mt-1">
                        <summary className="text-[10px] text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text-secondary)] transition-colors select-none">
                          Per-event detail ({step.descriptions.length})
                        </summary>
                        <ul className="mt-1 space-y-0.5">
                          {step.descriptions.map((d, i) => (
                            <li key={i} className="text-[11px] text-[var(--color-text-muted)] pl-2 border-l border-[var(--color-border-subtle)]">
                              {d}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                );
              })()}
              {step.fieldsAdded.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {step.fieldsAdded.map((f) => (
                    <span key={f} className="px-1.5 py-0.5 text-xs rounded bg-[var(--color-success)]/10 text-[var(--color-success)]">
                      +{f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
