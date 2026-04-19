/**
 * Find positions of a field's value in raw text, preferring context-aware matches.
 * For JSON/KV data, matches value only where it appears next to its field key,
 * preventing e.g. "accountId" from claiming "recipientAccountId"'s value.
 *
 * @param originalKey - The original raw key before underscore-stripping (e.g. "_GID" for
 *   field "GID"). When provided, context patterns are tried with this key first so that
 *   stripped-underscore fields from INDEXED_EXTRACTIONS=json can be located correctly.
 */
export function findFieldValuePositions(
  raw: string,
  field: string,
  value: string,
  originalKey?: string,
): number[] {
  const leafName = field.includes('.') ? field.split('.').pop()! : field;
  const originalLeaf = originalKey
    ? (originalKey.includes('.') ? originalKey.split('.').pop()! : originalKey)
    : undefined;

  const escapedVal = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const buildContextPatterns = (key: string) => {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [
      new RegExp(`"${escapedKey}"\\s*:\\s*"${escapedVal}"`, 'g'),           // "key":"value"
      new RegExp(`"${escapedKey}"\\s*:\\s*${escapedVal}(?=[,}\\s])`, 'g'),  // "key":numvalue
      new RegExp(`(?:^|[\\s,;])${escapedKey}="${escapedVal}"`, 'gm'),       // key="value"
      new RegExp(`(?:^|[\\s,;])${escapedKey}=${escapedVal}(?=[,;\\s]|$)`, 'gm'), // key=value
    ];
  };

  // Collect unique keys to try. Prefer original (un-stripped) key so `_GID` matches before `GID`.
  const keysToTry = originalLeaf && originalLeaf !== leafName
    ? [originalLeaf, leafName]
    : [leafName];

  const contextPositions: number[] = [];
  for (const key of keysToTry) {
    for (const pattern of buildContextPatterns(key)) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(raw)) !== null) {
        const valIdx = raw.indexOf(value, match.index);
        if (valIdx !== -1 && valIdx < match.index + match[0].length) {
          contextPositions.push(valIdx);
        }
      }
    }
    if (contextPositions.length > 0) break; // original key matched — no need to try stripped name
  }

  if (contextPositions.length > 0) return contextPositions;

  // Fallback: plain indexOf — only for values of length >= 2 to avoid false-positive noise.
  // Short values that couldn't be context-matched (e.g. "0", "3") are skipped here; they
  // will only highlight when context matching succeeds above.
  if (value.length < 2) return [];
  const positions: number[] = [];
  let idx = raw.indexOf(value);
  while (idx !== -1) {
    positions.push(idx);
    idx = raw.indexOf(value, idx + 1);
  }
  return positions;
}
