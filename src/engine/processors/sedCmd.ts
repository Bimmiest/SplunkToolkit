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
 *   - `\0` and a bare `&` → the whole match, which JS spells `$&`. Mapping `\0`
 *                   to `$0` emitted the marker itself: JS does not recognise
 *                   `$0` as a substitution, so `s/b/[\0]/` on "abc" produced
 *                   the literal "a[$0]c" rather than "a[b]c".
 *   - `\<char>`   → the escaped literal, with the backslash dropped (this covers
 *                   an escaped delimiter like `s/b/x\/y/` → `x/y`, plus `\\` → `\`
 *                   and `\&` → a literal ampersand)
 *   - a bare `$`  → escaped to `$$` so JS doesn't read it as a substitution
 *                   pattern (sed treats `$` as an ordinary character)
 */
function buildReplacement(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\' && i + 1 < raw.length) {
      const next = raw.charAt(i + 1);
      if (next === '0') out += '$&';
      else if (next >= '1' && next <= '9') out += '$' + next;
      else if (next === '$') out += '$$';
      else out += next;
      i++;
      continue;
    }
    if (c === '&') { out += '$&'; continue; }
    out += c === '$' ? '$$' : c;
  }
  return out;
}

/**
 * A sed command is a verb followed by its delimiter, and the delimiter is any
 * character that is not alphanumeric, `_`, or whitespace.
 *
 * Testing `startsWith('s')` / `startsWith('y')` instead read ordinary prose as
 * a command: `SEDCMD-x = yes` was reported as unsimulated `y///`
 * transliteration, and `SEDCMD-x = something` was parsed as a substitution with
 * `o` for a delimiter — producing a nonsense pattern/replacement split rather
 * than "this is not a sed expression".
 */
const SED_COMMAND_RE = /^([sy])([^\w\s])/;

/** Shared shape for every diagnostic this file raises about one directive. */
function sedWarning(
  dir: ConfDirective | undefined,
  message: string,
): ValidationDiagnostic {
  return {
    level: 'warning',
    message: `SEDCMD-${dir?.className ?? ''}: ${message}`,
    file: 'props.conf',
    ...atDirective(dir),
    directiveKey: dir?.key,
  };
}

function parseSedExpression(
  value: string,
  dir?: ConfDirective,
  diagnostics?: ValidationDiagnostic[],
): SedCommand | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const command = SED_COMMAND_RE.exec(trimmed);
  if (!command) {
    diagnostics?.push(
      sedWarning(
        dir,
        `"${trimmed}" is not a sed expression and was ignored. SEDCMD takes ` +
          's/<regex>/<replacement>/<flags> (any non-alphanumeric character may be the delimiter).',
      ),
    );
    return null;
  }

  const [, verb, delimiter] = command;

  // y/// transliteration is documented but not simulated — surface it rather than
  // silently doing nothing (matching how crypto/eval stubs warn).
  if (verb === 'y') {
    diagnostics?.push(
      sedWarning(dir, 'y/// transliteration is not simulated — this directive has no effect in the preview.'),
    );
    return null;
  }

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

  if (parts.length < 2) {
    diagnostics?.push(
      sedWarning(
        dir,
        `"${trimmed}" is missing its closing delimiter "${delimiter}" and was ignored. ` +
          `SEDCMD takes s${delimiter}<regex>${delimiter}<replacement>${delimiter}<flags>.`,
      ),
    );
    return null;
  }

  const patternStr = parts[0] ?? '';
  const replacement = buildReplacement(parts[1] ?? '');
  const flags = parts[2] ?? '';
  const isGlobal = flags.includes('g');

  // The s/.../.../N occurrence flag (replace only the Nth match) is not simulated —
  // the engine replaces the first match (or all, with g). Warn so the divergence is visible.
  if (/\d/.test(flags)) {
    diagnostics?.push(
      sedWarning(
        dir,
        `the numeric occurrence flag (s/.../.../N) is not simulated — the preview replaces the ${isGlobal ? 'matches globally' : 'first match'} instead of only the Nth.`,
      ),
    );
  }

  const regex = safeRegex(patternStr, isGlobal ? 'g' : '');
  if (!regex) {
    // Every other regex-bearing directive already warns here (LINE_BREAKER,
    // BREAK_ONLY_BEFORE, MUST_BREAK_AFTER, EXTRACT, TRANSFORMS). SEDCMD is the
    // one most often used for masking PII, so a silent drop is the most costly
    // place to have it: the preview reads as "the pattern didn't match this
    // sample" when the truth is "the pattern never compiled".
    diagnostics?.push(
      sedWarning(
        dir,
        `the pattern (${patternStr}) could not be compiled safely (invalid regex or rejected as ` +
          'ReDoS-prone). The substitution was skipped, so the event is shown unmodified.',
      ),
    );
    return null;
  }

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
