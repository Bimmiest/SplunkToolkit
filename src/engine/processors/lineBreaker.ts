/**
 * Line Breaker Processor
 *
 * Simulates Splunk's line breaking and merging pipeline.
 * Uses LINE_BREAKER to split raw data into segments, then optionally
 * merges segments based on SHOULD_LINEMERGE and related directives.
 */

import type { ConfDirective, EventMetadata, SplunkEvent } from '../types';
import { safeRegex } from '../../utils/splunkRegex';

/**
 * Helper to find a directive value by key (case-insensitive).
 */
function getDirective(directives: ConfDirective[], key: string): string | undefined {
  const d = directives.find((dir) => dir.key.toUpperCase() === key.toUpperCase());
  return d?.value;
}

/**
 * Determine if a string looks like it starts with a date-like pattern.
 * Used when BREAK_ONLY_BEFORE_DATE = true.  Matches common timestamp
 * prefixes such as:
 *   2024-01-15  /  01/15/2024  /  Jan 15  /  Mon Jan 15  / epoch digits etc.
 */
const DATE_LIKE_PATTERN = safeRegex(
  '^\\s*(' +
    '\\d{4}[\\-/]\\d{1,2}[\\-/]\\d{1,2}' +      // 2024-01-15 or 2024/01/15
    '|\\d{1,2}[\\-/]\\d{1,2}[\\-/]\\d{2,4}' +    // 01-15-2024 or 1/15/24
    '|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d{1,2}' + // Jan 15
    '|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\s' +        // Mon ...
    '|\\d{10,13}' +                                // epoch seconds/millis
    ')'
);

/**
 * Compute line numbers for a substring within the full raw data.
 */
function computeLineNumbers(
  rawData: string,
  segmentStart: number,
  segmentEnd: number
): { start: number; end: number } {
  let startLine = 1;
  for (let i = 0; i < segmentStart && i < rawData.length; i++) {
    if (rawData[i] === '\n') startLine++;
  }
  let endLine = startLine;
  for (let i = segmentStart; i < segmentEnd && i < rawData.length; i++) {
    if (rawData[i] === '\n') endLine++;
  }
  return { start: startLine, end: endLine };
}

/**
 * Break raw data into SplunkEvent objects according to props.conf directives.
 *
 * Processing order mirrors Splunk:
 *  1. Apply LINE_BREAKER to split raw data into segments.
 *  2. If SHOULD_LINEMERGE is true (default), merge segments according to
 *     BREAK_ONLY_BEFORE, BREAK_ONLY_BEFORE_DATE, and MUST_BREAK_AFTER.
 *  3. Create SplunkEvent objects from the resulting segments.
 */
export function breakLines(
  rawData: string,
  directives: ConfDirective[],
  metadata: EventMetadata
): SplunkEvent[] {
  if (!rawData || rawData.length === 0) {
    return [];
  }

  // ── Step 1: LINE_BREAKER ──────────────────────────────────────────
  const lineBreakerPattern = getDirective(directives, 'LINE_BREAKER') ?? '([\\r\\n]+)';
  const lineBreakerRegex = safeRegex(lineBreakerPattern, 'g');

  let segments: string[];
  const segmentOffsets: number[] = []; // character offset of each segment in rawData

  if (!lineBreakerRegex) {
    // Invalid regex -- treat entire data as one segment
    segments = [rawData];
    segmentOffsets.push(0);
  } else {
    segments = [];
    // Use the LINE_BREAKER to split.  The capturing group content is the
    // separator and is discarded; text before and between matches are segments.
    // We must handle the capturing group properly: the part outside the group
    // belongs to segments, the captured group is the separator.
    //
    // Splunk LINE_BREAKER semantics: the regex must have exactly one
    // capturing group.  Everything before the first match is part of the
    // first segment.  Between matches, the text NOT captured by the group
    // belongs to the adjacent segments:
    //   - Text from the end of the *previous* captured group to the start of
    //     the current captured group is appended to the *current* segment
    //     (trailing part of the previous match plus leading part of this match).
    //
    // A simpler approach that matches most real-world configs:
    //   Split on the captured group.  The regex overall matches a region;
    //   the captured group within that region is what gets removed.

    // To split correctly we iterate matches ourselves.
    const nonGlobalRegex = safeRegex(lineBreakerPattern);
    if (!nonGlobalRegex) {
      segments = [rawData];
      segmentOffsets.push(0);
    } else {
      let remaining = rawData;
      let offset = 0;

      while (remaining.length > 0) {
        const m = nonGlobalRegex.exec(remaining);
        if (!m || m.index === undefined) {
          // No more matches -- rest is last segment
          if (remaining.length > 0) {
            segments.push(remaining);
            segmentOffsets.push(offset);
          }
          break;
        }

        // The full match spans m.index .. m.index + m[0].length
        // The captured group is m[1], which is the separator to discard.
        // Text before the full match belongs to the current segment.
        // Text between start of full match and start of captured group
        // also belongs to the current segment.
        const fullMatchStart = m.index;
        const _fullMatchEnd = m.index + m[0].length; void _fullMatchEnd;

        // Find where the captured group sits within the full match.
        // m[1] starts at some position within m[0].
        let captureStartInMatch = 0;
        let captureEndInMatch = m[0].length;
        if (m[1] !== undefined) {
          const captureIdx = m[0].indexOf(m[1]);
          if (captureIdx !== -1) {
            captureStartInMatch = captureIdx;
            captureEndInMatch = captureIdx + m[1].length;
          }
        }

        // Segment text = everything before the captured group
        const segmentText = remaining.substring(0, fullMatchStart + captureStartInMatch);
        if (segmentText.length > 0 || segments.length === 0) {
          segments.push(segmentText);
          segmentOffsets.push(offset);
        }

        // Advance past the captured group.  Any text between the end of
        // the captured group and the end of the full match becomes the
        // start of the next segment (handled by leaving it in `remaining`).
        const advanceTo = fullMatchStart + captureEndInMatch;
        offset += advanceTo;
        remaining = remaining.substring(advanceTo);

        // Guard against zero-length matches to prevent infinite loops
        if (advanceTo === 0) {
          if (remaining.length > 0) {
            // Push one character and continue
            segments.push(remaining[0]);
            segmentOffsets.push(offset);
            remaining = remaining.substring(1);
            offset += 1;
          } else {
            break;
          }
        }
      }
    }
  }

  // Filter out empty segments
  const filteredSegments: { text: string; offset: number }[] = [];
  for (let i = 0; i < segments.length; i++) {
    const text = segments[i];
    if (text.length > 0) {
      filteredSegments.push({ text, offset: segmentOffsets[i] ?? 0 });
    }
  }

  if (filteredSegments.length === 0) {
    return [];
  }

  // ── Step 2: SHOULD_LINEMERGE ──────────────────────────────────────
  const shouldLineMergeVal = getDirective(directives, 'SHOULD_LINEMERGE');
  const shouldLineMerge = shouldLineMergeVal === undefined || shouldLineMergeVal.toLowerCase() === 'true';

  let mergedSegments: { text: string; offset: number }[];

  if (!shouldLineMerge) {
    mergedSegments = filteredSegments;
  } else {
    // Merge directives
    const breakOnlyBeforeStr = getDirective(directives, 'BREAK_ONLY_BEFORE');
    const breakOnlyBeforeDateStr = getDirective(directives, 'BREAK_ONLY_BEFORE_DATE');
    const mustBreakAfterStr = getDirective(directives, 'MUST_BREAK_AFTER');

    const breakOnlyBeforeRegex = breakOnlyBeforeStr
      ? safeRegex(breakOnlyBeforeStr)
      : null;
    const breakOnlyBeforeDate =
      breakOnlyBeforeDateStr !== undefined &&
      breakOnlyBeforeDateStr.toLowerCase() === 'true';
    const mustBreakAfterRegex = mustBreakAfterStr
      ? safeRegex(mustBreakAfterStr)
      : null;

    mergedSegments = [filteredSegments[0]];
    let forceBreakNext = false;

    // Check if the very first segment triggers MUST_BREAK_AFTER
    if (mustBreakAfterRegex && mustBreakAfterRegex.test(filteredSegments[0].text)) {
      forceBreakNext = true;
    }

    for (let i = 1; i < filteredSegments.length; i++) {
      const seg = filteredSegments[i];
      let startNewEvent = false;

      // If previous segment triggered MUST_BREAK_AFTER, force a new event
      if (forceBreakNext) {
        startNewEvent = true;
        forceBreakNext = false;
      }

      // BREAK_ONLY_BEFORE: only start new event if regex matches at start
      if (!startNewEvent && breakOnlyBeforeRegex) {
        if (breakOnlyBeforeRegex.test(seg.text)) {
          startNewEvent = true;
        }
      }

      // BREAK_ONLY_BEFORE_DATE: only break before date-like patterns
      if (!startNewEvent && breakOnlyBeforeDate) {
        if (DATE_LIKE_PATTERN && DATE_LIKE_PATTERN.test(seg.text)) {
          startNewEvent = true;
        }
      }

      // If neither BREAK_ONLY_BEFORE nor BREAK_ONLY_BEFORE_DATE is set,
      // each segment is its own event by default under linemerge
      if (
        !startNewEvent &&
        !breakOnlyBeforeRegex &&
        !breakOnlyBeforeDate
      ) {
        // Default linemerge behavior: no specific break rule means
        // we keep merging (Splunk's default is to merge everything
        // unless a break condition says otherwise). But in practice
        // Splunk's default SHOULD_LINEMERGE=true with no BREAK_ONLY_*
        // directives still breaks on each LINE_BREAKER segment.
        // So each segment is its own event.
        startNewEvent = true;
      }

      if (startNewEvent) {
        mergedSegments.push({ text: seg.text, offset: seg.offset });
      } else {
        // Merge into previous
        const prev = mergedSegments[mergedSegments.length - 1];
        prev.text += '\n' + seg.text;
      }

      // Check MUST_BREAK_AFTER for this segment
      if (mustBreakAfterRegex) {
        if (mustBreakAfterRegex.test(seg.text)) {
          forceBreakNext = true;
        } else {
          forceBreakNext = false;
        }
      }
    }
  }

  // ── Step 3: Create SplunkEvent objects ────────────────────────────
  const events: SplunkEvent[] = mergedSegments.map((seg) => {
    const lineNums = computeLineNumbers(rawData, seg.offset, seg.offset + seg.text.length);
    return {
      _raw: seg.text,
      _time: null,
      _meta: {},
      fields: {},
      metadata: { ...metadata },
      lineNumbers: lineNums,
      processingTrace: [
        {
          processor: 'lineBreaker',
          phase: 'index-time',
          description: `LINE_BREAKER split raw data into segment (lines ${lineNums.start}-${lineNums.end})`,
          outputSnapshot: seg.text.substring(0, 200),
          fieldsAdded: [],
          fieldsModified: [],
        },
      ],
    };
  });

  // Add a summary trace entry if merging occurred
  if (shouldLineMerge && filteredSegments.length !== mergedSegments.length) {
    const mergeInfo: string[] = [];
    if (getDirective(directives, 'BREAK_ONLY_BEFORE')) {
      mergeInfo.push(`BREAK_ONLY_BEFORE=${getDirective(directives, 'BREAK_ONLY_BEFORE')}`);
    }
    if (getDirective(directives, 'BREAK_ONLY_BEFORE_DATE')) {
      mergeInfo.push(`BREAK_ONLY_BEFORE_DATE=${getDirective(directives, 'BREAK_ONLY_BEFORE_DATE')}`);
    }
    if (getDirective(directives, 'MUST_BREAK_AFTER')) {
      mergeInfo.push(`MUST_BREAK_AFTER=${getDirective(directives, 'MUST_BREAK_AFTER')}`);
    }
    for (const ev of events) {
      ev.processingTrace.push({
        processor: 'lineBreaker',
        phase: 'index-time',
        description:
          `SHOULD_LINEMERGE=true merged ${filteredSegments.length} segments into ${mergedSegments.length} events` +
          (mergeInfo.length > 0 ? ` (${mergeInfo.join(', ')})` : ''),
        fieldsAdded: [],
        fieldsModified: [],
      });
    }
  }

  return events;
}
