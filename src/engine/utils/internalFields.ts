/**
 * Splunk reserves leading `_` for internal fields. Names in this set are kept
 * verbatim when a field is produced at index time; any other leading-underscore
 * name is stripped to match real Splunk behaviour.
 */
export const INTERNAL_FIELD_NAMES = new Set<string>([
  '_raw',
  '_time',
  '_meta',
  '_indextime',
  '_cd',
  '_bkt',
  '_serial',
  '_sourcetype',
  '_subsecond',
  '_kv',
  '_eventtype_color',
]);

export function isInternalField(name: string): boolean {
  return INTERNAL_FIELD_NAMES.has(name);
}

/**
 * Strip leading underscores from a field name unless it is a recognised
 * internal field (e.g. `_raw`, `_time`). Used by index-time field producers
 * (INDEXED_EXTRACTIONS headers, INGEST_EVAL LHS, WRITE_META targets).
 */
export function stripLeadingUnderscoreForField(name: string): string {
  if (isInternalField(name)) return name;
  return name.replace(/^_+/, '');
}
