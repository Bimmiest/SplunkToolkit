import type { SplunkEvent, ConfStanza, ConfDirective } from '../types';
import { safeRegex, convertSplunkToJsRegex } from '../../utils/splunkRegex';
import { stripLeadingUnderscoreForField } from '../utils/internalFields';
import { getField, hasField, setField, addFieldValue } from '../utils/fieldBag';
import { getSourceKeyValue } from '../utils/metadataFields';

export interface TransformResult {
  fields: Record<string, string | string[]>;
  destKey?: string;
  destValue?: string;
  matched: boolean;
}

// Pre-compiled patterns for format string substitution.
const CAPTURE_REF_PATTERN = /\$(\d+)/g;
const NAMED_REF_PATTERN = /\$\{(\w+)\}/g;

interface CompiledRegex { plain: RegExp; global: RegExp }

// Cache compiled regexes per stanza to avoid re-compiling on every event.
// WeakMap so entries are GC'd when stanza objects are collected.
//
// Keyed on the PATTERN as well as the stanza. Keying on the stanza alone was
// correct only by accident of lifecycle — parseConf builds fresh stanza objects
// every run, so a stanza's REGEX could not change without invalidating the key —
// and nothing said so. A caller that mutated a stanza in place, or reused a
// ParsedConf across runs, would silently get the previous pattern back, and a
// stale regex is a *valid* regex: no error, just quietly wrong extractions.
const regexCache = new WeakMap<ConfStanza, Map<string, CompiledRegex | null>>();

// These DEST_KEY targets are single-valued slots in Splunk's pipeline.
// FORMAT is applied to the first match only — multi-value accumulation would
// produce a mangled string (e.g. "auditd\nsourcetype::auditd\n…") that the
// router cannot correctly parse.
const SINGLE_VALUE_DEST_KEYS = new Set([
  'MetaData:Host',
  'MetaData:Index',
  'MetaData:Source',
  'MetaData:Sourcetype',
  '_meta',
  '_time',
  'queue',
]);

function getCompiledRegex(transformStanza: ConfStanza, jsPattern: string): CompiledRegex | null {
  let byPattern = regexCache.get(transformStanza);
  if (!byPattern) {
    byPattern = new Map();
    regexCache.set(transformStanza, byPattern);
  }
  const cached = byPattern.get(jsPattern);
  if (cached !== undefined) return cached;

  const plain = safeRegex(jsPattern);
  const global = safeRegex(jsPattern, 'g');
  const result = plain && global ? { plain, global } : null;
  byPattern.set(jsPattern, result);
  return result;
}

/** Last directive with the given key in a stanza (Splunk last-definition-wins), or undefined. */
function lastDirective(stanza: ConfStanza, key: string): ConfDirective | undefined {
  for (let i = stanza.directives.length - 1; i >= 0; i--) {
    const directive = stanza.directives[i];
    if (directive?.key === key) return directive;
  }
  return undefined;
}

/** One `key::value` token from a search-time FORMAT, still holding its `$N` references. */
interface FormatPair {
  key: string;
  value: string;
}

/**
 * Split a FORMAT string into its `key::value` pairs *without* substituting
 * captures, so a capture containing spaces or `::` cannot change the pair
 * structure (transforms.conf.spec, "FORMAT for search-time extractions").
 *
 * Both halves may hold `$N` references — `FORMAT = $1::$2` names the field from
 * one capture and its value from another. A value may be double-quoted to carry
 * literal whitespace: `field::"a b"`.
 */
function parseFormatPairs(format: string): FormatPair[] {
  const pairs: FormatPair[] = [];
  let i = 0;

  while (i < format.length) {
    while (i < format.length && /\s/.test(format.charAt(i))) i++;
    if (i >= format.length) break;

    // Keys never contain whitespace, so the `::` separator must appear in the
    // run that starts here. A run without one is stray text — skip it.
    let runEnd = i;
    while (runEnd < format.length && !/\s/.test(format.charAt(runEnd))) runEnd++;
    const sep = format.indexOf('::', i);
    if (sep < 0) break;
    if (sep >= runEnd) {
      i = runEnd;
      continue;
    }

    const key = format.slice(i, sep);
    i = sep + 2;

    let value: string;
    if (format.charAt(i) === '"') {
      const end = format.indexOf('"', i + 1);
      if (end < 0) {
        value = format.slice(i + 1);
        i = format.length;
      } else {
        value = format.slice(i + 1, end);
        i = end + 1;
      }
    } else {
      let end = i;
      while (end < format.length && !/\s/.test(format.charAt(end))) end++;
      value = format.slice(i, end);
      i = end;
    }

    if (key) pairs.push({ key, value });
  }

  return pairs;
}

function expandFormat(format: string, match: RegExpExecArray, priorDestValue?: string): string {
  // match[0] is the whole match; match[1..maxIndex] are the capture groups.
  const maxIndex = match.length - 1;
  let result = format.replace(CAPTURE_REF_PATTERN, (whole, digits) => {
    // The pattern greedily grabs every trailing digit, but a reference resolves
    // to at most `maxIndex`. Mirror PCRE/JS `$nn` fallback: take the LONGEST
    // leading digit-run that names an existing group; any remaining digits are
    // literal text. (So with one group, `$10` → group 1 followed by a literal
    // `0`, not the non-existent group 10.)
    for (let len = digits.length; len > 0; len--) {
      const idx = parseInt(digits.slice(0, len), 10);
      if (idx <= maxIndex) {
        // transforms.conf.spec: `$0` is "what was in the DEST_KEY before the
        // REGEX was performed", not the whole match. Use the prior DEST_KEY value
        // when one is known; fall back to the whole match otherwise (e.g. field
        // extractions with no DEST_KEY).
        const base = idx === 0 && priorDestValue !== undefined ? priorDestValue : (match[idx] ?? '');
        return base + digits.slice(len);
      }
    }
    // No leading digit-run names a real group — leave the `$N` text untouched.
    return whole;
  });
  if (match.groups) {
    const groups = match.groups;
    result = result.replace(NAMED_REF_PATTERN, (_, name) => groups[name] ?? '');
  }
  return result;
}

/**
 * Resolve the current contents of DEST_KEY (used for `$0` in FORMAT). Returns
 * `undefined` when there is no DEST_KEY, so `$0` falls back to the whole match.
 */
function resolvePriorDestValue(event: SplunkEvent, destKey: string | undefined): string | undefined {
  if (!destKey) return undefined;
  if (destKey === '_raw') return event._raw;
  const norm = destKey.replace(/^_(?=MetaData:)/i, '');
  switch (norm) {
    case 'MetaData:Host': return event.metadata.host;
    case 'MetaData:Index': return event.metadata.index;
    case 'MetaData:Source': return event.metadata.source;
    case 'MetaData:Sourcetype': return event.metadata.sourcetype;
  }
  const v = getField(event.fields, destKey);
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

function addMultiValue(
  fields: Record<string, string | string[]>,
  key: string,
  value: string,
): void {
  // hasOwn-guarded + `__proto__`-safe: a named group like `(?<toString>…)` is
  // stored as a real field rather than reading back the inherited function.
  addFieldValue(fields, key, value);
}

/** Resolve the value a transform reads from, honouring SOURCE_KEY (default _raw). */
function resolveSourceValue(event: SplunkEvent, sourceKeyDir?: ConfDirective): string {
  const sourceKey = sourceKeyDir?.value.trim() ?? '_raw';
  // Built-in pipeline slots (`_raw`, `_meta`, `queue`, `MetaData:*`) are not
  // stored in `fields`; reading them from there returned "" and made the whole
  // transform silently never match — including the canonical sourcetype-override
  // pattern this registry documents as its own example.
  const builtin = getSourceKeyValue(event, sourceKey);
  if (builtin !== undefined) return builtin;
  const v = getField(event.fields, sourceKey);
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

/** Decode the escape sequences Splunk allows inside DELIMS/FIELDS quoted tokens. */
function decodeDelimEscapes(s: string): string {
  return s.replace(/\\([tnr"\\])/g, (_, c) =>
    c === 't' ? '\t' : c === 'n' ? '\n' : c === 'r' ? '\r' : c,
  );
}

/**
 * Parse a comma-separated list of double-quoted tokens — used for both DELIMS
 * (each token is a set of delimiter characters) and FIELDS (each token is a
 * field name). Falls back to an unquoted comma-split for leniency.
 */
function parseDelimList(raw: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out.push(decodeDelimEscapes(m[1] ?? ''));
  if (out.length === 0) {
    for (const part of raw.split(',')) {
      const t = part.trim();
      if (t) out.push(decodeDelimEscapes(t));
    }
  }
  return out;
}

/** Split on ANY single character in `delims` — each character is its own delimiter. */
function splitOnAnyChar(value: string, delims: string): string[] {
  if (!delims) return [value];
  const set = new Set(delims);
  const parts: string[] = [];
  let cur = '';
  for (const ch of value) {
    if (set.has(ch)) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

/**
 * DELIMS/FIELDS delimiter-based extraction (the alternative to REGEX).
 *  - Two DELIMS sets → field/value pairs: first set splits pairs, second splits
 *    key from value (on the first key-delimiter occurrence).
 *  - One DELIMS set + FIELDS → positional values named by FIELDS.
 * Keys/values are trimmed; empty values are dropped (KEEP_EMPTY_VALS default false).
 */
function applyDelimsExtraction(
  event: SplunkEvent,
  stanza: ConfStanza,
  delimsDir: ConfDirective,
  sourceKeyDir: ConfDirective | undefined,
  writeMeta: boolean,
): TransformResult {
  const result: TransformResult = { fields: {}, matched: false };
  const sourceValue = resolveSourceValue(event, sourceKeyDir);
  if (!sourceValue) return result;

  const delimSets = parseDelimList(delimsDir.value);
  if (delimSets.length === 0) return result;

  const cleanName = (raw: string) => (writeMeta ? stripLeadingUnderscoreForField(raw.trim()) : raw.trim());

  if (delimSets.length >= 2) {
    const [pairDelims = '', kvDelims = ''] = delimSets;
    const kvDelimSet = new Set(kvDelims);
    for (const pair of splitOnAnyChar(sourceValue, pairDelims)) {
      let splitAt = -1;
      for (let i = 0; i < pair.length; i++) {
        if (kvDelimSet.has(pair.charAt(i))) {
          splitAt = i;
          break;
        }
      }
      if (splitAt < 0) continue;
      const key = cleanName(pair.slice(0, splitAt));
      const value = pair.slice(splitAt + 1).trim();
      if (!key || !value) continue;
      addMultiValue(result.fields, key, value);
    }
  } else {
    const fieldsDir = lastDirective(stanza, 'FIELDS');
    if (!fieldsDir) return result;
    const names = parseDelimList(fieldsDir.value);
    const values = splitOnAnyChar(sourceValue, delimSets[0] ?? '');
    for (let i = 0; i < names.length && i < values.length; i++) {
      const key = cleanName(names[i] ?? '');
      const value = (values[i] ?? '').trim();
      if (!key || !value) continue;
      addMultiValue(result.fields, key, value);
    }
  }

  result.matched = Object.keys(result.fields).length > 0;
  return result;
}

export function applyRegexTransform(
  event: SplunkEvent,
  transformStanza: ConfStanza,
  onInvalidRegex?: (pattern: string) => void,
  phase: 'index-time' | 'search-time' = 'index-time',
): TransformResult {
  // Splunk's last-definition-wins rule: a repeated key within a stanza (including
  // one produced by merging duplicate same-name stanzas) takes its LAST value.
  const regexDir = lastDirective(transformStanza, 'REGEX');
  const formatDir = lastDirective(transformStanza, 'FORMAT');
  const sourceKeyDir = lastDirective(transformStanza, 'SOURCE_KEY');
  // DEST_KEY is index-time only (transforms.conf.spec: "only relevant for
  // index-time field extractions"). Reached through a search-time REPORT-, the
  // stanza performs field extraction and nothing else — so FORMAT is read as
  // `field::value` pairs, exactly as it would be with no DEST_KEY present.
  const destKeyDir = phase === 'index-time' ? lastDirective(transformStanza, 'DEST_KEY') : undefined;
  const writeMetaDir = lastDirective(transformStanza, 'WRITE_META');
  const writeMeta = writeMetaDir?.value.trim().toLowerCase() === 'true';
  // REPEAT_MATCH: re-run the regex to find every match (default: first match only).
  // MV_ADD: when a field is extracted more than once, accumulate into a multivalue
  // field rather than discarding the later value (default: keep the first).
  const repeatMatch = lastDirective(transformStanza, 'REPEAT_MATCH')?.value.trim().toLowerCase() === 'true';
  const mvAdd = lastDirective(transformStanza, 'MV_ADD')?.value.trim().toLowerCase() === 'true';

  const result: TransformResult = { fields: {}, matched: false };

  // DELIMS-based (delimiter) extraction is used in place of REGEX.
  const delimsDir = lastDirective(transformStanza, 'DELIMS');
  if (delimsDir) {
    return applyDelimsExtraction(event, transformStanza, delimsDir, sourceKeyDir, writeMeta);
  }

  if (!regexDir) return result;

  const sourceValue = resolveSourceValue(event, sourceKeyDir);

  const jsPattern = convertSplunkToJsRegex(regexDir.value.trim());
  const compiled = getCompiledRegex(transformStanza, jsPattern);
  if (!compiled) {
    // Invalid PCRE-ism or a pattern the ReDoS heuristic refused — the transform
    // silently does nothing, so let the caller surface a diagnostic.
    onInvalidRegex?.(regexDir.value.trim());
    return result;
  }

  // Match once with the plain (non-global) regex; reused below to decide named vs
  // numbered handling and as the first match for non-REPEAT_MATCH extraction.
  const firstMatch = compiled.plain.exec(sourceValue);
  if (!firstMatch) return result;

  result.matched = true;

  const destKey = destKeyDir?.value.trim();
  const priorDestValue = resolvePriorDestValue(event, destKey);
  const hasNamedGroups = firstMatch.groups !== undefined;
  // Index-time FORMAT defaults to `<stanza-name>::$1` when omitted (transforms.conf.spec).
  // Named capture groups auto-extract without a FORMAT, so the default only applies
  // to a REGEX that uses numbered groups (at least group 1 must exist to reference).
  const format =
    formatDir?.value.trim() ??
    (!hasNamedGroups && firstMatch.length > 1 ? `${transformStanza.name}::$1` : undefined);

  if (format) {
    if (destKey === '_raw') {
      // DEST_KEY=_raw replaces the ENTIRE event with the FORMAT expansion of the
      // first match — it is NOT a sed-style substitution. Anything the regex does
      // not capture and FORMAT does not reproduce is discarded. (SEDCMD is the
      // tool for substituting in place while keeping the rest of the event.)
      const m = compiled.plain.exec(sourceValue);
      if (m) {
        result.destKey = destKey;
        result.destValue = expandFormat(format, m, priorDestValue);
      }
    } else if (destKey) {
      // Normalise _MetaData:X alias so lookup works for both forms.
      const normalisedDestKey = destKey.replace(/^_(?=MetaData:)/i, '');

      if (SINGLE_VALUE_DEST_KEYS.has(normalisedDestKey)) {
        // Single-valued metadata slot: FORMAT applies to the first match only.
        const m = compiled.plain.exec(sourceValue);
        if (m) {
          result.destKey = destKey;
          result.destValue = expandFormat(format, m, priorDestValue);
        }
      } else {
        // DEST_KEY=<field>: accumulate one value per match as a multi-value field.
        const { global } = compiled;
        global.lastIndex = 0;
        let m: RegExpExecArray | null;
        let firstValue: string | undefined;
        const extraValues: string[] = [];
        while ((m = global.exec(sourceValue)) !== null) {
          const formatted = expandFormat(format, m, priorDestValue);
          if (firstValue === undefined) {
            firstValue = formatted;
          } else {
            extraValues.push(formatted);
          }
          // Guard against zero-length matches (e.g. a regex like `(.*)` that can
          // match the empty string) — without advancing, lastIndex never moves and
          // global.exec loops forever.
          if (m.index === global.lastIndex) global.lastIndex++;
        }
        if (firstValue !== undefined) {
          result.destKey = destKey;
          result.destValue = extraValues.length === 0 ? firstValue : [firstValue, ...extraValues].join('\n');
        }
      }
    } else {
      // No DEST_KEY: FORMAT is "field1::$1 field2::$2". The pair structure is
      // parsed from the FORMAT *before* captures are substituted, then each
      // half is expanded on its own — Splunk tokenizes FORMAT at config time and
      // substitutes afterwards. Expanding first would let a captured value's own
      // spaces end the value early, and let a captured `::` synthesize a field.
      const pairs = parseFormatPairs(format);
      const { global } = compiled;
      global.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = global.exec(sourceValue)) !== null) {
        for (const pair of pairs) {
          const expandedKey = expandFormat(pair.key, m);
          const field = writeMeta ? stripLeadingUnderscoreForField(expandedKey) : expandedKey;
          if (field) addMultiValue(result.fields, field, expandFormat(pair.value, m));
        }
        // Guard against zero-length outer matches looping forever.
        if (m.index === global.lastIndex) global.lastIndex++;
      }
    }
  } else {
    // No FORMAT — extract named capture groups. REPEAT_MATCH=true re-runs the
    // regex across the event (all matches); otherwise only the first match is used.
    // When a field is captured more than once, MV_ADD=true accumulates a multivalue
    // field while MV_ADD=false keeps the first value and discards the rest.
    const matches: RegExpMatchArray[] = repeatMatch
      ? [...sourceValue.matchAll(compiled.global)]
      : [firstMatch];

    const assignField = (name: string, value: string) => {
      const fieldName = writeMeta ? stripLeadingUnderscoreForField(name) : name;
      if (!fieldName) return;
      if (!hasField(result.fields, fieldName)) {
        setField(result.fields, fieldName, value);
      } else if (mvAdd) {
        addMultiValue(result.fields, fieldName, value);
      }
      // else: field already set and MV_ADD is false — discard the later value.
    };

    for (const match of matches) {
      if (!match.groups) continue;
      const groups = match.groups;

      // _KEY_<suffix>/_VAL_<suffix>: the KEY group's captured text is the field
      // NAME and the paired VAL group's text is the value (transforms.conf.spec
      // dynamic KV). Resolve these before treating groups as literal field names.
      const dynamicSuffixes = new Set<string>();
      for (const gname of Object.keys(groups)) {
        const km = /^_KEY_(.+)$/.exec(gname);
        if (km?.[1]) dynamicSuffixes.add(km[1]);
      }
      for (const suffix of dynamicSuffixes) {
        const keyText = groups[`_KEY_${suffix}`];
        const valText = groups[`_VAL_${suffix}`];
        if (keyText === undefined || valText === undefined) continue;
        assignField(keyText, valText);
      }

      // Remaining named groups become fields verbatim (skip the _KEY_/_VAL_ pair
      // groups, which are extraction machinery rather than real field names).
      for (const [name, value] of Object.entries(groups)) {
        if (value === undefined) continue;
        if (/^_(?:KEY|VAL)_/.test(name)) continue;
        assignField(name, value);
      }
    }
  }

  return result;
}
