import type { SplunkEvent } from '../types';
import type { TransformResult } from './regexTransform';

export function applyDestKey(event: SplunkEvent, result: TransformResult): SplunkEvent | null {
  if (!result.matched || !result.destKey || !result.destValue) {
    // No routing, just add extracted fields
    return {
      ...event,
      fields: { ...event.fields, ...result.fields },
    };
  }

  // Normalise _MetaData:X → MetaData:X (Splunk alias).
  // Only strip the leading _ when followed by "MetaData:" — never strip from
  // built-in keys like _raw, _meta, _time.
  const destKey = result.destKey.replace(/^_(?=MetaData:)/i, '');
  const destValue = result.destValue;

  switch (destKey) {
    case '_raw':
      return { ...event, _raw: destValue, fields: { ...event.fields, ...result.fields } };

    case '_meta': {
      // _meta values are space-separated key::value pairs
      const meta = { ...event._meta };
      const pairs = destValue.split(/\s+/);
      for (const pair of pairs) {
        const idx = pair.indexOf('::');
        if (idx > 0) {
          meta[pair.substring(0, idx)] = pair.substring(idx + 2);
        }
      }
      return { ...event, _meta: meta, fields: { ...event.fields, ...result.fields } };
    }

    case '_time': {
      const epoch = parseFloat(destValue);
      return {
        ...event,
        _time: isNaN(epoch) ? event._time : new Date(epoch * 1000),
        fields: { ...event.fields, ...result.fields },
      };
    }

    case 'queue':
      // nullQueue = drop event from pipeline; indexQueue = keep
      if (destValue === 'nullQueue') return null;
      return {
        ...event,
        _meta: { ...event._meta, _queue: destValue },
        fields: { ...event.fields, ...result.fields },
      };

    case 'MetaData:Host':
      // Splunk requires FORMAT to include "host::" prefix; without it the update is silently skipped.
      if (!destValue.startsWith('host::')) {
        return { ...event, fields: { ...event.fields, ...result.fields } };
      }
      return {
        ...event,
        metadata: { ...event.metadata, host: destValue.slice('host::'.length) },
        fields: { ...event.fields, ...result.fields },
      };

    case 'MetaData:Index':
      if (!destValue.startsWith('index::')) {
        return { ...event, fields: { ...event.fields, ...result.fields } };
      }
      return {
        ...event,
        metadata: { ...event.metadata, index: destValue.slice('index::'.length) },
        fields: { ...event.fields, ...result.fields },
      };

    case 'MetaData:Source':
      if (!destValue.startsWith('source::')) {
        return { ...event, fields: { ...event.fields, ...result.fields } };
      }
      return {
        ...event,
        metadata: { ...event.metadata, source: destValue.slice('source::'.length) },
        fields: { ...event.fields, ...result.fields },
      };

    case 'MetaData:Sourcetype':
      if (!destValue.startsWith('sourcetype::')) {
        return { ...event, fields: { ...event.fields, ...result.fields } };
      }
      return {
        ...event,
        metadata: { ...event.metadata, sourcetype: destValue.slice('sourcetype::'.length) },
        fields: { ...event.fields, ...result.fields },
      };

    default:
      // Treat as a field name
      return {
        ...event,
        fields: { ...event.fields, ...result.fields, [destKey]: destValue },
      };
  }
}
