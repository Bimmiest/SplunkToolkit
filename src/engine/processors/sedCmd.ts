import type { SplunkEvent, ConfDirective, ValidationDiagnostic } from '../types';
import { safeRegex } from '../../utils/splunkRegex';
import { byClassName } from '../utils/asciiCompare';

interface SedCommand {
  className: string;
  pattern: RegExp;
  replacement: string;
  global: boolean;
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
      line: dir?.line,
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
  // Convert sed/Splunk backreferences (\1..\9) to JS replacement syntax ($1..$9).
  // First escape any literal `$` to `$$` — in sed `$` is a literal character, but
  // JS String.replace treats `$1`/`$&` as substitution patterns, so an un-escaped
  // `$` (e.g. s/price/$5.00/) would mangle the output. Escape before introducing
  // our own `$n` backrefs so they survive.
  const replacement = (parts[1] ?? '')
    .replace(/\$/g, '$$$$')
    .replace(/\\(\d)/g, '$$$1');
  const flags = parts[2] ?? '';
  const isGlobal = flags.includes('g');

  // The s/.../.../N occurrence flag (replace only the Nth match) is not simulated —
  // the engine replaces the first match (or all, with g). Warn so the divergence is visible.
  if (/\d/.test(flags)) {
    diagnostics?.push({
      level: 'warning',
      message: `SEDCMD-${dir?.className ?? ''}: the numeric occurrence flag (s/.../.../N) is not simulated — the preview replaces the ${isGlobal ? 'matches globally' : 'first match'} instead of only the Nth.`,
      file: 'props.conf',
      line: dir?.line,
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

    for (const cmd of commands) {
      const before = raw;
      raw = raw.replace(cmd.pattern, cmd.replacement);

      if (raw !== before) {
        traces.push({
          processor: `SEDCMD-${cmd.className}`,
          phase: 'index-time',
          description: `Applied sed substitution`,
          inputSnapshot: before.substring(0, 200),
          outputSnapshot: raw.substring(0, 200),
        });
      }
    }

    return {
      ...event,
      _raw: raw,
      processingTrace: [...event.processingTrace, ...traces],
    };
  });
}
