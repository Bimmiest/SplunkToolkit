import type { ScaffoldSuggestion } from './types';

/** Render a props.conf stanza from the selected directive suggestions. */
export function renderStanza(sourcetype: string, suggestions: ScaffoldSuggestion[]): string {
  const lines = [`[${sourcetype}]`];
  for (const s of suggestions) lines.push(`${s.key} = ${s.value}`);
  return lines.join('\n');
}

/** Append a stanza to existing props.conf text (or set it when the file is empty). */
export function appendStanza(existing: string, stanza: string): string {
  const trimmed = existing.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${stanza}\n` : `${stanza}\n`;
}
