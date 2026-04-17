const MAX_DEPTH = 10;

/**
 * Recursively flattens a JSON object into dot-notation fields.
 *
 * - Nested objects produce a parent key (stringified) and child keys (e.g. `user.name`)
 * - Arrays of primitives become multi-value fields
 * - Arrays of objects are indexed (e.g. `items.0.id`, `items.1.id`)
 * - Returns true if the depth limit was hit (caller can surface a diagnostic).
 */
export function flattenJson(
  obj: Record<string, unknown>,
  fields: Record<string, string | string[]>,
  added: string[],
  prefix = '',
  depth = 0,
): boolean {
  if (depth > MAX_DEPTH) return true;

  for (const [key, value] of Object.entries(obj)) {
    const fieldName = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      fields[fieldName] = '';
      added.push(fieldName);
    } else if (Array.isArray(value)) {
      const allPrimitive = value.every(
        (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
      );

      if (allPrimitive) {
        fields[fieldName] = value.map(String);
        added.push(fieldName);
      } else {
        // Mixed or object array — store stringified parent + recurse indexed children
        fields[fieldName] = JSON.stringify(value);
        added.push(fieldName);
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            if (flattenJson(item as Record<string, unknown>, fields, added, `${fieldName}.${i}`, depth + 1)) return true;
          } else if (item !== null && item !== undefined) {
            fields[`${fieldName}.${i}`] = String(item);
            added.push(`${fieldName}.${i}`);
          }
        }
      }
    } else if (typeof value === 'object') {
      // Nested object — store stringified parent + recurse children
      fields[fieldName] = JSON.stringify(value);
      added.push(fieldName);
      if (flattenJson(value as Record<string, unknown>, fields, added, fieldName, depth + 1)) return true;
    } else {
      fields[fieldName] = String(value);
      added.push(fieldName);
    }
  }
  return false;
}
