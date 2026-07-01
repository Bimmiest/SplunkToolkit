import type { SplunkEvent, ConfStanza, ConfDirective } from '../types';
import { safeRegex, convertSplunkToJsRegex } from '../../utils/splunkRegex';
import { stripLeadingUnderscoreForField } from '../utils/internalFields';

export interface TransformResult {
  fields: Record<string, string | string[]>;
  destKey?: string;
  destValue?: string;
  matched: boolean;
}

// Pre-compiled patterns for format string substitution.
const CAPTURE_REF_PATTERN = /\$(\d+)/g;
const NAMED_REF_PATTERN = /\$\{(\w+)\}/g;

// Cache compiled regexes per stanza to avoid re-compiling on every event.
// WeakMap so entries are GC'd when stanza objects are collected.
const regexCache = new WeakMap<ConfStanza, { plain: RegExp; global: RegExp } | null>();

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

function getCompiledRegex(transformStanza: ConfStanza, jsPattern: string): { plain: RegExp; global: RegExp } | null {
  if (regexCache.has(transformStanza)) return regexCache.get(transformStanza)!;
  const plain = safeRegex(jsPattern);
  const global = safeRegex(jsPattern, 'g');
  const result = plain && global ? { plain, global } : null;
  regexCache.set(transformStanza, result);
  return result;
}

function expandFormat(format: string, match: RegExpExecArray): string {
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
      if (idx <= maxIndex) return (match[idx] ?? '') + digits.slice(len);
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

function addMultiValue(
  fields: Record<string, string | string[]>,
  key: string,
  value: string,
): void {
  const existing = fields[key];
  if (existing === undefined) {
    fields[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    fields[key] = [existing, value];
  }
}

/** Resolve the value a transform reads from, honouring SOURCE_KEY (default _raw). */
function resolveSourceValue(event: SplunkEvent, sourceKeyDir?: ConfDirective): string {
  const sourceKey = sourceKeyDir?.value.trim() ?? '_raw';
  if (sourceKey === '_raw') return event._raw;
  const v = event.fields[sourceKey];
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
  while ((m = re.exec(raw)) !== null) out.push(decodeDelimEscapes(m[1]));
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
    const pairDelims = delimSets[0];
    const kvDelims = new Set(delimSets[1]);
    for (const pair of splitOnAnyChar(sourceValue, pairDelims)) {
      let splitAt = -1;
      for (let i = 0; i < pair.length; i++) {
        if (kvDelims.has(pair[i])) {
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
    const fieldsDir = stanza.directives.find((d) => d.key === 'FIELDS');
    if (!fieldsDir) return result;
    const names = parseDelimList(fieldsDir.value);
    const values = splitOnAnyChar(sourceValue, delimSets[0]);
    for (let i = 0; i < names.length && i < values.length; i++) {
      const key = cleanName(names[i]);
      const value = values[i].trim();
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
): TransformResult {
  const regexDir = transformStanza.directives.find((d) => d.key === 'REGEX');
  const formatDir = transformStanza.directives.find((d) => d.key === 'FORMAT');
  const sourceKeyDir = transformStanza.directives.find((d) => d.key === 'SOURCE_KEY');
  const destKeyDir = transformStanza.directives.find((d) => d.key === 'DEST_KEY');
  const writeMetaDir = transformStanza.directives.find((d) => d.key === 'WRITE_META');
  const writeMeta = writeMetaDir?.value.trim().toLowerCase() === 'true';
  // REPEAT_MATCH: re-run the regex to find every match (default: first match only).
  // MV_ADD: when a field is extracted more than once, accumulate into a multivalue
  // field rather than discarding the later value (default: keep the first).
  const repeatMatch = transformStanza.directives.find((d) => d.key === 'REPEAT_MATCH')?.value.trim().toLowerCase() === 'true';
  const mvAdd = transformStanza.directives.find((d) => d.key === 'MV_ADD')?.value.trim().toLowerCase() === 'true';

  const result: TransformResult = { fields: {}, matched: false };

  // DELIMS-based (delimiter) extraction is used in place of REGEX.
  const delimsDir = transformStanza.directives.find((d) => d.key === 'DELIMS');
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

  // Quick match check using plain (non-global) regex to avoid mutating lastIndex here.
  if (!compiled.plain.test(sourceValue)) return result;

  result.matched = true;

  const destKey = destKeyDir?.value.trim();
  const format = formatDir?.value.trim();

  if (format) {
    if (destKey === '_raw') {
      // DEST_KEY=_raw replaces the ENTIRE event with the FORMAT expansion of the
      // first match — it is NOT a sed-style substitution. Anything the regex does
      // not capture and FORMAT does not reproduce is discarded. (SEDCMD is the
      // tool for substituting in place while keeping the rest of the event.)
      const m = compiled.plain.exec(sourceValue);
      if (m) {
        result.destKey = destKey;
        result.destValue = expandFormat(format, m);
      }
    } else if (destKey) {
      // Normalise _MetaData:X alias so lookup works for both forms.
      const normalisedDestKey = destKey.replace(/^_(?=MetaData:)/i, '');

      if (SINGLE_VALUE_DEST_KEYS.has(normalisedDestKey)) {
        // Single-valued metadata slot: FORMAT applies to the first match only.
        const m = compiled.plain.exec(sourceValue);
        if (m) {
          result.destKey = destKey;
          result.destValue = expandFormat(format, m);
        }
      } else {
        // DEST_KEY=<field>: accumulate one value per match as a multi-value field.
        const { global } = compiled;
        global.lastIndex = 0;
        let m: RegExpExecArray | null;
        let firstValue: string | undefined;
        const extraValues: string[] = [];
        while ((m = global.exec(sourceValue)) !== null) {
          const formatted = expandFormat(format, m);
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
      // No DEST_KEY: parse FORMAT as "field1::$1 field2::$2" — iterate all matches.
      // Supports quoted values: field::"value with spaces"
      const PAIR_RE = /(\w+)::(?:"([^"]*)"|(\S+))/g;
      const { global } = compiled;
      global.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = global.exec(sourceValue)) !== null) {
        const formatted = expandFormat(format, m);
        PAIR_RE.lastIndex = 0;
        let p: RegExpExecArray | null;
        while ((p = PAIR_RE.exec(formatted)) !== null) {
          const field = writeMeta ? stripLeadingUnderscoreForField(p[1]) : p[1];
          const value = p[2] !== undefined ? p[2] : p[3];
          if (field) addMultiValue(result.fields, field, value);
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
    let matches: RegExpMatchArray[];
    if (repeatMatch) {
      matches = [...sourceValue.matchAll(compiled.global)];
    } else {
      const m = compiled.plain.exec(sourceValue);
      matches = m ? [m] : [];
    }

    for (const match of matches) {
      if (!match.groups) continue;
      for (const [name, value] of Object.entries(match.groups)) {
        if (value === undefined) continue;
        const fieldName = writeMeta ? stripLeadingUnderscoreForField(name) : name;
        if (!fieldName) continue;
        if (result.fields[fieldName] === undefined) {
          result.fields[fieldName] = value;
        } else if (mvAdd) {
          addMultiValue(result.fields, fieldName, value);
        }
        // else: field already set and MV_ADD is false — discard the later value.
      }
    }
  }

  return result;
}
