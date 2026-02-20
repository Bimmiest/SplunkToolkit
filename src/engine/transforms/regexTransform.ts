import type { SplunkEvent, ConfStanza } from '../types';
import { safeRegex } from '../../utils/splunkRegex';

export interface TransformResult {
  fields: Record<string, string | string[]>;
  destKey?: string;
  destValue?: string;
  matched: boolean;
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

  const regex = safeRegex(regexDir.value.trim());
  if (!regex) return result;

  const match = regex.exec(sourceValue);
  if (!match) return result;

  result.matched = true;

  const destKey = destKeyDir?.value.trim();
  const format = formatDir?.value.trim();

  if (format) {
    if (destKey === '_raw') {
      // For DEST_KEY = _raw, perform a regex substitution within the source text
      // (like sed s/REGEX/FORMAT/g). JS .replace() handles $1, $2 natively.
      const globalRegex = safeRegex(regexDir.value.trim(), 'g');
      if (globalRegex) {
        result.destKey = destKey;
        result.destValue = sourceValue.replace(globalRegex, format);
      }
    } else if (destKey) {
      // For other DEST_KEYs, compute the formatted value from the first match
      let formatted = format;
      for (let i = 0; i <= match.length; i++) {
        formatted = formatted.replace(new RegExp(`\\$${i}`, 'g'), match[i] ?? '');
      }
      if (match.groups) {
        for (const [name, value] of Object.entries(match.groups)) {
          if (value !== undefined) {
            formatted = formatted.replace(new RegExp(`\\$\\{${name}\\}`, 'g'), value);
          }
        }
      }
      result.destKey = destKey;
      result.destValue = formatted;
    } else {
      // Default: parse FORMAT as "fieldname::value fieldname2::value2"
      let formatted = format;
      for (let i = 0; i <= match.length; i++) {
        formatted = formatted.replace(new RegExp(`\\$${i}`, 'g'), match[i] ?? '');
      }
      if (match.groups) {
        for (const [name, value] of Object.entries(match.groups)) {
          if (value !== undefined) {
            formatted = formatted.replace(new RegExp(`\\$\\{${name}\\}`, 'g'), value);
          }
        }
      }
      const pairs = formatted.match(/(\w+)::((?:[^\s]|\\ )+)/g);
      if (pairs) {
        for (const pair of pairs) {
          const colonIdx = pair.indexOf('::');
          const field = pair.substring(0, colonIdx);
          const value = pair.substring(colonIdx + 2);
          result.fields[field] = value;
        }
      }
    }
  } else if (match.groups) {
    // No FORMAT — use named capture groups as fields
    for (const [name, value] of Object.entries(match.groups)) {
      if (value !== undefined) {
        result.fields[name] = value;
      }
    }
  }

  return result;
}
