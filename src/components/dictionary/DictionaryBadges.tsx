import type React from 'react';
import type { DirectiveInfo } from '../../engine/directiveRegistry';

type Tone = 'index' | 'search' | 'neutral' | 'danger';

const TONE_COLORS: Record<Tone, string> = {
  // Index-time warning-amber and search-time accent match the colour coding the
  // pipeline reference drawer already uses for the two phases.
  index: 'var(--color-warning)',
  search: 'var(--color-accent)',
  neutral: 'var(--color-text-muted)',
  danger: 'var(--color-error)',
};

/**
 * Small tinted pill. Distinct from the shared Badge component, which offers
 * only the four diagnostic severities — nothing here is a diagnostic.
 */
export function Chip({
  tone = 'neutral',
  mono = false,
  children,
}: {
  tone?: Tone;
  mono?: boolean;
  children: React.ReactNode;
}) {
  const color = TONE_COLORS[tone];
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight whitespace-nowrap ${mono ? 'font-mono' : ''}`}
      style={{ backgroundColor: `${color}20`, color }}
    >
      {children}
    </span>
  );
}

const PHASE_TONE: Record<DirectiveInfo['phase'], Tone> = {
  'index-time': 'index',
  'search-time': 'search',
  both: 'neutral',
};

const PHASE_LABEL: Record<DirectiveInfo['phase'], string> = {
  'index-time': 'Index-time',
  'search-time': 'Search-time',
  both: 'Index + search',
};

export function PhaseBadge({ phase }: { phase: DirectiveInfo['phase'] }) {
  return <Chip tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Chip>;
}

export function FileBadge({ appliesTo }: { appliesTo: DirectiveInfo['appliesTo'] }) {
  return <Chip mono>{appliesTo === 'both' ? 'props + transforms' : appliesTo}</Chip>;
}

/** The full badge row for a directive, in a fixed order so rows stay scannable. */
export function DirectiveBadges({ info }: { info: DirectiveInfo }) {
  return (
    <>
      <PhaseBadge phase={info.phase} />
      <FileBadge appliesTo={info.appliesTo} />
      {info.isClassBased && <Chip>class-based</Chip>}
      {info.deprecated && <Chip tone="danger">deprecated</Chip>}
    </>
  );
}
