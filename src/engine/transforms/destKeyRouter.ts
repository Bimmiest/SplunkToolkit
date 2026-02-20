import type { SplunkEvent } from '../types';
import type { TransformResult } from './regexTransform';

export function applyDestKey(event: SplunkEvent, result: TransformResult): SplunkEvent {
  if (!result.matched || !result.destKey || !result.destValue) {
    // No routing, just add extracted fields
    return {
      ...event,
      fields: { ...event.fields, ...result.fields },
    };
  }

  // Normalise: Splunk accepts both _MetaData:X and MetaData:X
  const destKey = result.destKey.replace(/^_/, '');
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
      // nullQueue = drop event, indexQueue = keep
      return {
        ...event,
        _meta: { ...event._meta, _queue: destValue },
        fields: { ...event.fields, ...result.fields },
      };

    case 'MetaData:Host':
      return {
        ...event,
        metadata: { ...event.metadata, host: destValue.replace(/^host::/, '') },
        fields: { ...event.fields, ...result.fields },
      };

    case 'MetaData:Index':
      return {
        ...event,
        metadata: { ...event.metadata, index: destValue.replace(/^index::/, '') },
        fields: { ...event.fields, ...result.fields },
      };

    case 'MetaData:Source':
      return {
        ...event,
        metadata: { ...event.metadata, source: destValue.replace(/^source::/, '') },
        fields: { ...event.fields, ...result.fields },
      };

    case 'MetaData:Sourcetype':
      return {
        ...event,
        metadata: { ...event.metadata, sourcetype: destValue.replace(/^sourcetype::/, '') },
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
