import type { SplunkEvent, ConfDirective, RawMutation, ValidationDiagnostic } from '../types';
import { safeRegex } from '../../utils/splunkRegex';
import { byClassName } from '../utils/asciiCompare';
import { changeWindow } from '../utils/changeWindow';
import { atDirective } from '../parser/provenance';

interface SedCommand {
  className: string;
  pattern: RegExp;
  replacement: string;
  global: boolean;
}

/**
 * Turn a parsed sed replacement string into a JS `String.replace` replacement.
 * The parser preserves backslashes verbatim, so this single left-to-right pass
 * resolves the escapes with sed's semantics:
 *   - `\1`..`\9`  → capture-group backreferences (`$1`..`$9`)
 *   - `\<char>`   → the escaped literal, with the backslash dropped (this covers
 *                   an escaped delimiter like `s/b/x\/y/` → `x/y`, plus `\\` → `\`)
 *   - a bare `$`  → escaped to `$$` so JS doesn't read it as a substitution
 *                   pattern (sed treats `$` as an ordinary character)
 */
function buildReplacement(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      // \0..\9 stay backreferences (mirrors the previous \\(\d) → $n behaviour);
      // any other escaped character becomes the bare literal.
      out += next >= '0' && next <= '9' ? '$' + next : next === '$' ? '$$' : next;
      i++;
      continue;
    }
    out += c === '$' ? '$$' : c;
  }
  return out;
}

function parseSedExpression(
  value: string,
  dir?: ConfDirective,
  diagnostics?: ValidationDiagnostic[],
): SedCommand | null {
  const trimmed = value.trim();

  // y/// transliteration is documented but not simulated — surface it rather than
  // silently doing nothing (matching how crypto/eval stubs warn).
  if (trimmed.startsWith('y') && trimmed.length > 1) {
    diagnostics?.push({
      level: 'warning',
      message: `SEDCMD-${dir?.className ?? ''}: y/// transliteration is not simulated — this directive has no effect in the preview.`,
      file: 'props.conf',
      ...atDirective(dir),
      directiveKey: dir?.key,
    });
    return null;
  }

  if (!trimmed.startsWith('s')) return null;

  const delimiter = trimmed[1];
  if (!delimiter) return null;

  const parts: string[] = [];
  let current = '';
  let escaped = false;

  for (let i = 2; i < trimmed.length; i++) {
    if (escaped) {
      current += trimmed[i];
      escaped = false;
      continue;
    }
    if (trimmed[i] === '\\') {
      escaped = true;
      current += '\\';
      continue;
    }
    if (trimmed[i] === delimiter) {
      parts.push(current);
      current = '';
      continue;
    }
    current += trimmed[i];
  }
  if (current) parts.push(current);

  if (parts.length < 2) return null;

  const patternStr = parts[0];
  const replacement = buildReplacement(parts[1] ?? '');
  const flags = parts[2] ?? '';
  const isGlobal = flags.includes('g');

  // The s/.../.../N occurrence flag (replace only the Nth match) is not simulated —
  // the engine replaces the first match (or all, with g). Warn so the divergence is visible.
  if (/\d/.test(flags)) {
    diagnostics?.push({
      level: 'warning',
      message: `SEDCMD-${dir?.className ?? ''}: the numeric occurrence flag (s/.../.../N) is not simulated — the preview replaces the ${isGlobal ? 'matches globally' : 'first match'} instead of only the Nth.`,
      file: 'props.conf',
      ...atDirective(dir),
      directiveKey: dir?.key,
    });
  }

  const regex = safeRegex(patternStr, isGlobal ? 'g' : '');
  if (!regex) return null;

  return {
    className: '',
    pattern: regex,
    replacement,
    global: isGlobal,
  };
}

export function applySedCommands(
  events: SplunkEvent[],
  directives: ConfDirective[],
  diagnostics?: ValidationDiagnostic[],
): SplunkEvent[] {
  const sedDirectives = directives
    .filter((d) => d.directiveType === 'SEDCMD')
    .sort(byClassName);

  if (sedDirectives.length === 0) return events;

  const commands: (SedCommand & { directive: ConfDirective })[] = [];
  for (const dir of sedDirectives) {
    const cmd = parseSedExpression(dir.value, dir, diagnostics);
    if (cmd) {
      cmd.className = dir.className ?? '';
      commands.push({ ...cmd, directive: dir });
    }
  }

  if (commands.length === 0) return events;

  return events.map((event) => {
    let raw = event._raw;
    const traces: SplunkEvent['processingTrace'] = [];
    const mutations: RawMutation[] = [];

    for (const cmd of commands) {
      const before = raw;
      raw = raw.replace(cmd.pattern, cmd.replacement);

      if (raw !== before) {
        // Each command is attributed separately: two SEDCMDs masking two
        // different fields must not collapse into one undifferentiated "masking
        // happened" note.
        mutations.push({
          traceIndex: event.processingTrace.length + traces.length,
          rawBefore: before,
          rawAfter: raw,
        });
        traces.push({
          processor: `SEDCMD-${cmd.className}`,
          phase: 'index-time',
          description: `Applied sed substitution`,
          ...changeWindow(before, raw),
        });
      }
    }

    return {
      ...event,
      _raw: raw,
      processingTrace: [...event.processingTrace, ...traces],
      rawMutations: [...(event.rawMutations ?? []), ...mutations],
    };
  });
}
