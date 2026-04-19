import type { ReactNode } from 'react';
import type { SplunkEvent } from '../../../../engine/types';
import { HighlightedRaw } from './HighlightedRaw';

interface FieldEventCardProps {
  event: SplunkEvent;
  globalIdx: number;
  badges: ReactNode;
  fieldColorMap: Map<string, string>;
  /** field name → value(s) to highlight in the raw text */
  fieldValues: Map<string, string | string[]>;
  activeFields: Set<string> | null;
  titleFor: (field: string, value: string) => string;
  onFieldHover: (field: string | null) => void;
  onFieldClick: (field: string) => void;
  /** Maps stripped field name → original raw key for context-aware highlighting */
  fieldSourceKeys?: Record<string, string>;
  /** Optional footer content (e.g. key=value summary, Eval Expressions) */
  children?: ReactNode;
}

export function FieldEventCard({
  event,
  globalIdx,
  badges,
  fieldColorMap,
  fieldValues,
  activeFields,
  titleFor,
  onFieldHover,
  onFieldClick,
  fieldSourceKeys,
  children,
}: FieldEventCardProps) {
  return (
    <div className="border border-[var(--color-border)] rounded bg-[var(--color-bg-secondary)]">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">Event #{globalIdx}</span>
        {badges}
      </div>
      <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all">
        <HighlightedRaw
          raw={event._raw}
          fieldColorMap={fieldColorMap}
          fieldValues={fieldValues}
          activeFields={activeFields}
          titleFor={titleFor}
          onFieldHover={onFieldHover}
          onFieldClick={onFieldClick}
          fieldSourceKeys={fieldSourceKeys}
        />
      </pre>
      {children}
    </div>
  );
}
