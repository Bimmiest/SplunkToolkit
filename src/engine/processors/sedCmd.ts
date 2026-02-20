import type { SplunkEvent, ConfDirective } from '../types';
import { safeRegex } from '../../utils/splunkRegex';

interface SedCommand {
  className: string;
  pattern: RegExp;
  replacement: string;
  global: boolean;
}

function parseSedExpression(value: string): SedCommand | null {
  const trimmed = value.trim();
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
  const replacement = parts[1];
  const flags = parts[2] ?? '';
  const isGlobal = flags.includes('g');

  const regex = safeRegex(patternStr, isGlobal ? 'g' : '');
  if (!regex) return null;

  return {
    className: '',
    pattern: regex,
    replacement,
    global: isGlobal,
  };
}

export function applySedCommands(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const sedDirectives = directives
    .filter((d) => d.directiveType === 'SEDCMD')
    .sort((a, b) => (a.className ?? '').localeCompare(b.className ?? ''));

  if (sedDirectives.length === 0) return events;

  const commands: (SedCommand & { directive: ConfDirective })[] = [];
  for (const dir of sedDirectives) {
    const cmd = parseSedExpression(dir.value);
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
      // Reset regex lastIndex for global patterns
      cmd.pattern.lastIndex = 0;
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
