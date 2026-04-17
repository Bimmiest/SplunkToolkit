import type { SplunkEvent, ConfStanza } from '../types';
import { safeRegex, convertSplunkToJsRegex } from '../../utils/splunkRegex';

export interface TransformResult {
  fields: Record<string, string | string[]>;
  destKey?: string;
  destValue?: string;
  matched: boolean;
}

// Pre-compiled pattern for $N back-reference substitution (replaces per-match new RegExp loops).
const CAPTURE_REF_PATTERN = /\$(\d+)/g;

// Cache compiled regexes per stanza to avoid re-compiling on every event.
// WeakMap so entries are GC'd when stanza objects are collected.
const regexCache = new WeakMap<ConfStanza, { plain: RegExp; global: RegExp } | null>();

function getCompiledRegex(transformStanza: ConfStanza, jsPattern: string): { plain: RegExp; global: RegExp } | null {
  if (regexCache.has(transformStanza)) return regexCache.get(transformStanza)!;
  const plain = safeRegex(jsPattern);
  const global = safeRegex(jsPattern, 'g');
  const result = plain && global ? { plain, global } : null;
  regexCache.set(transformStanza, result);
  return result;
}

function expandFormat(format: string, match: RegExpExecArray): string {
  let result = format.replace(CAPTURE_REF_PATTERN, (_, idx) => match[parseInt(idx)] ?? '');
  if (match.groups) {
    for (const [name, value] of Object.entries(match.groups)) {
      if (value !== undefined) {
        result = result.replace(new RegExp(`\\$\\{${name}\\}`, 'g'), value);
      }
    }
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

export function applyRegexTransform(
  event: SplunkEvent,
  transformStanza: ConfStanza
): TransformResult {
  const regexDir = transformStanza.directives.find((d) => d.key === 'REGEX');
  const formatDir = transformStanza.directives.find((d) => d.key === 'FORMAT');
  const sourceKeyDir = transformStanza.directives.find((d) => d.key === 'SOURCE_KEY');
  const destKeyDir = transformStanza.directives.find((d) => d.key === 'DEST_KEY');

  const result: TransformResult = { fields: {}, matched: false };

  if (!regexDir) return result;

  const sourceKey = sourceKeyDir?.value.trim() ?? '_raw';
  const sourceValue = sourceKey === '_raw'
    ? event._raw
    : (Array.isArray(event.fields[sourceKey]) ? (event.fields[sourceKey] as string[])[0] : event.fields[sourceKey] as string) ?? '';

  const jsPattern = convertSplunkToJsRegex(regexDir.value.trim());
  const compiled = getCompiledRegex(transformStanza, jsPattern);
  if (!compiled) return result;

  // Quick match check using plain (non-global) regex to avoid mutating lastIndex here.
  if (!compiled.plain.test(sourceValue)) return result;

  result.matched = true;

  const destKey = destKeyDir?.value.trim();
  const format = formatDir?.value.trim();

  if (format) {
    if (destKey === '_raw') {
      // DEST_KEY=_raw: global substitution (like sed s/REGEX/FORMAT/g).
      result.destKey = destKey;
      result.destValue = sourceValue.replace(compiled.global, (...args) => {
        const lastArg = args[args.length - 1];
        const hasNamed = lastArg !== null && typeof lastArg === 'object' && !Array.isArray(lastArg);
        const namedGroups = hasNamed ? lastArg as Record<string, string> : undefined;
        const groupCount = args.length - (hasNamed ? 4 : 3);
        // Build a fake RegExpExecArray-like object for expandFormat
        const fakeMatch = args.slice(0, groupCount + 1) as RegExpExecArray;
        let formatted = format.replace(CAPTURE_REF_PATTERN, (_, idx) => fakeMatch[parseInt(idx)] ?? '');
        if (namedGroups) {
          for (const [name, value] of Object.entries(namedGroups)) {
            if (value !== undefined) {
              formatted = formatted.replace(new RegExp(`\\$\\{${name}\\}`, 'g'), value);
            }
          }
        }
        return formatted;
      });
    } else if (destKey) {
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
      }
      if (firstValue !== undefined) {
        result.destKey = destKey;
        result.destValue = extraValues.length === 0 ? firstValue : [firstValue, ...extraValues].join('\n');
      }
    } else {
      // No DEST_KEY: parse FORMAT as "field1::$1 field2::$2" — iterate all matches.
      const { global } = compiled;
      global.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = global.exec(sourceValue)) !== null) {
        const formatted = expandFormat(format, m);
        const pairs = formatted.match(/(\w+)::((?:[^\s]|\\ )+)/g);
        if (pairs) {
          for (const pair of pairs) {
            const colonIdx = pair.indexOf('::');
            const field = pair.substring(0, colonIdx);
            const value = pair.substring(colonIdx + 2);
            addMultiValue(result.fields, field, value);
          }
        }
      }
    }
  } else {
    // No FORMAT — use named capture groups from first match as fields.
    const match = compiled.plain.exec(sourceValue);
    if (match?.groups) {
      for (const [name, value] of Object.entries(match.groups)) {
        if (value !== undefined) {
          result.fields[name] = value;
        }
      }
    }
  }

  return result;
}
