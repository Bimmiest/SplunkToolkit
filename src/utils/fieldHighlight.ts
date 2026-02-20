/**
 * Find positions of a field's value in raw text, preferring context-aware matches.
 * For JSON/KV data, matches value only where it appears next to its field key,
 * preventing e.g. "accountId" from claiming "recipientAccountId"'s value.
 */
export function findFieldValuePositions(raw: string, field: string, value: string): number[] {
  // Use the leaf field name (last segment after '.') for key matching
  const leafName = field.includes('.') ? field.split('.').pop()! : field;

  // Try context-aware patterns: "key":"value", "key": "value", key=value, key="value"
  const escapedKey = leafName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedVal = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const contextPatterns = [
    new RegExp(`"${escapedKey}"\\s*:\\s*"${escapedVal}"`, 'g'),          // "key":"value"
    new RegExp(`"${escapedKey}"\\s*:\\s*${escapedVal}(?=[,}\\s])`, 'g'), // "key":numvalue
    new RegExp(`(?:^|[\\s,;])${escapedKey}="${escapedVal}"`, 'gm'),      // key="value"
    new RegExp(`(?:^|[\\s,;])${escapedKey}=${escapedVal}(?=[,;\\s]|$)`, 'gm'), // key=value
  ];

  const contextPositions: number[] = [];
  for (const pattern of contextPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw)) !== null) {
      // Find the actual value position within the match
      const valIdx = raw.indexOf(value, match.index);
      if (valIdx !== -1 && valIdx < match.index + match[0].length) {
        contextPositions.push(valIdx);
      }
    }
  }

  if (contextPositions.length > 0) return contextPositions;

  // Fallback: plain indexOf for values not found via context (e.g. calculated fields)
  const positions: number[] = [];
  let idx = raw.indexOf(value);
  while (idx !== -1) {
    positions.push(idx);
    idx = raw.indexOf(value, idx + 1);
  }
  return positions;
}
