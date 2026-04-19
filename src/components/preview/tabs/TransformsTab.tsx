import { useMemo } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { Icon } from '../../ui/Icon';
import { Tooltip } from '../../ui/Tooltip';

interface StepSummary {
  processor: string;
  phase: 'index-time' | 'search-time';
  description: string;
  eventsAffected: number;
  totalEvents: number;
  fieldsAdded: string[];
}

export function TransformsTab() {
  const result = useAppStore((s) => s.processingResult);

  const summary = useMemo(() => {
    if (!result) return { indexTime: [] as StepSummary[], searchTime: [] as StepSummary[] };

    const totalEvents = result.events.length;
    const stepMap = new Map<string, StepSummary>();

    for (const event of result.events) {
      for (const step of event.processingTrace) {
        const key = `${step.processor}:${step.description}`;
        const existing = stepMap.get(key);
        if (existing) {
          existing.eventsAffected++;
          if (step.fieldsAdded) {
            for (const f of step.fieldsAdded) {
              if (!existing.fieldsAdded.includes(f)) {
                existing.fieldsAdded.push(f);
              }
            }
          }
        } else {
          stepMap.set(key, {
            processor: step.processor,
            phase: step.phase,
            description: step.description,
            eventsAffected: 1,
            totalEvents,
            fieldsAdded: step.fieldsAdded ? [...step.fieldsAdded] : [],
          });
        }
      }
    }

    const indexTime: StepSummary[] = [];
    const searchTime: StepSummary[] = [];
    for (const s of stepMap.values()) {
      if (s.phase === 'index-time') indexTime.push(s);
      else searchTime.push(s);
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
              <div className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                {step.description}
              </div>
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
