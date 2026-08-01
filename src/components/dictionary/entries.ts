import { getAllDirectives, type DirectiveInfo } from '../../engine/directiveRegistry';
import { STANZA_KINDS, type StanzaKind } from '../../engine/stanzaRegistry';

/**
 * One selectable thing in the dictionary. Stanza headers and directives are
 * browsed in the same list but carry different fields, so they stay distinct
 * shapes rather than being flattened into a lowest common denominator.
 */
export type DictionaryEntry =
  | { kind: 'directive'; id: string; title: string; info: DirectiveInfo }
  | { kind: 'stanza'; id: string; title: string; stanza: StanzaKind };

/**
 * Entry ids are the directive key ("TIME_PREFIX") or a `stanza:`-prefixed
 * stanza id ("stanza:source"). One flat string keeps `dictionarySelection` in
 * the store simple enough to deep-link to from a Monaco action or a command
 * palette item; the prefix is unambiguous because no Splunk directive key
 * contains a colon.
 */
export const STANZA_ID_PREFIX = 'stanza:';

export const STANZA_GROUP = 'Stanza Headers';

export function buildEntries(): DictionaryEntry[] {
  const stanzas: DictionaryEntry[] = STANZA_KINDS.map((stanza) => ({
    kind: 'stanza',
    id: `${STANZA_ID_PREFIX}${stanza.id}`,
    title: stanza.label,
    stanza,
  }));

  const directives: DictionaryEntry[] = getAllDirectives().map((info) => ({
    kind: 'directive',
    id: info.key,
    title: info.key,
    info,
  }));

  return [...stanzas, ...directives];
}

/** Group heading an entry belongs under in the browse list. */
export function groupOf(entry: DictionaryEntry): string {
  return entry.kind === 'stanza' ? STANZA_GROUP : entry.info.category;
}

export interface DictionaryFilters {
  search: string;
  phase: 'all' | 'index-time' | 'search-time';
  file: 'all' | 'props.conf' | 'transforms.conf';
  hideDeprecated: boolean;
}

export const DEFAULT_FILTERS: DictionaryFilters = {
  search: '',
  phase: 'all',
  file: 'all',
  hideDeprecated: false,
};

/**
 * Apply the filter bar to the entry list.
 *
 * Stanza headers survive every filter except search. They are props.conf-only
 * and index-time-ish, but filtering them out when someone narrows to
 * "search-time" would hide the thing that decides which stanza a setting even
 * belongs in — and they are only four rows.
 */
export function filterEntries(
  entries: DictionaryEntry[],
  filters: DictionaryFilters,
): DictionaryEntry[] {
  const needle = filters.search.trim().toLowerCase();

  return entries.filter((entry) => {
    if (needle) {
      const haystack =
        entry.kind === 'stanza'
          ? `${entry.title} ${entry.stanza.description}`
          : `${entry.info.key} ${entry.info.description} ${entry.info.category}`;
      if (!haystack.toLowerCase().includes(needle)) return false;
    }

    if (entry.kind === 'stanza') return true;

    // `phase: 'both'` directives match either phase filter — a directive that
    // runs at index AND search time is relevant to someone browsing either.
    if (filters.phase !== 'all' && entry.info.phase !== 'both' && entry.info.phase !== filters.phase) {
      return false;
    }
    if (filters.file !== 'all' && entry.info.appliesTo !== 'both' && entry.info.appliesTo !== filters.file) {
      return false;
    }
    if (filters.hideDeprecated && entry.info.deprecated) return false;

    return true;
  });
}

/**
 * Group entries for display, preserving the registry's category order and
 * keeping stanza headers pinned to the top.
 */
export function groupEntries(entries: DictionaryEntry[]): { group: string; entries: DictionaryEntry[] }[] {
  const groups = new Map<string, DictionaryEntry[]>();
  for (const entry of entries) {
    const group = groupOf(entry);
    const existing = groups.get(group);
    if (existing) existing.push(entry);
    else groups.set(group, [entry]);
  }
  return [...groups.entries()].map(([group, list]) => ({ group, entries: list }));
}
