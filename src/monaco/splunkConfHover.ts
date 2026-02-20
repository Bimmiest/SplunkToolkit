import type { languages, editor, Position, CancellationToken } from 'monaco-editor';
import { getDirectiveInfo, getClassBasedDirectiveBase } from './directiveRegistry';

export function createHoverProvider(fileType: 'props.conf' | 'transforms.conf'): languages.HoverProvider {
  return {
    provideHover(
      model: editor.ITextModel,
      position: Position,
      _token: CancellationToken
    ): languages.ProviderResult<languages.Hover> {
      const line = model.getLineContent(position.lineNumber);

      // Check if hovering over a stanza header
      const stanzaMatch = line.match(/^\[(.+)\]$/);
      if (stanzaMatch) {
        const stanzaName = stanzaMatch[1];
        return {
          contents: [{ value: getStanzaHoverContent(stanzaName) }],
          range: {
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: line.length + 1,
          },
        };
      }

      // Check if hovering over a directive key (before =)
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0 && position.column - 1 <= eqIdx) {
        const key = line.substring(0, eqIdx).trim();

        // Try exact match first
        let info = getDirectiveInfo(key, fileType);

        // Try class-based match
        if (!info) {
          const parsed = getClassBasedDirectiveBase(key);
          if (parsed) {
            info = getDirectiveInfo(parsed.base, fileType);
          }
        }

        if (info) {
          const keyStart = line.indexOf(key) + 1;
          return {
            contents: [{ value: formatDirectiveHover(info, key) }],
            range: {
              startLineNumber: position.lineNumber,
              startColumn: keyStart,
              endLineNumber: position.lineNumber,
              endColumn: keyStart + key.length,
            },
          };
        }
      }

      return null;
    },
  };
}

function formatDirectiveHover(info: import('./directiveRegistry').DirectiveInfo, actualKey: string): string {
  const parts: string[] = [];

  parts.push(`### ${actualKey}`);

  if (info.isClassBased && actualKey.includes('-')) {
    const className = actualKey.split('-').slice(1).join('-');
    parts.push(`*Class-based directive* (\`${info.key}-<${className}>\`)`);
  }

  parts.push('');
  parts.push(info.description);
  parts.push('');

  parts.push('| Property | Value |');
  parts.push('|----------|-------|');
  parts.push(`| **Category** | ${info.category} |`);
  parts.push(`| **Phase** | ${info.phase} |`);
  parts.push(`| **Type** | ${info.valueType} |`);
  parts.push(`| **Default** | \`${info.defaultValue || '(none)'}\` |`);
  parts.push(`| **Applies to** | ${info.appliesTo} |`);

  if (info.enumValues && info.enumValues.length > 0) {
    parts.push(`| **Valid values** | ${info.enumValues.map((v) => `\`${v}\``).join(', ')} |`);
  }

  parts.push('');
  parts.push(`**Example:**`);
  parts.push(`\`\`\``);
  parts.push(info.example);
  parts.push(`\`\`\``);

  if (info.deprecated) {
    parts.push('');
    parts.push('> **Deprecated:** This directive is deprecated and may be removed in future versions.');
  }

  return parts.join('\n');
}

function getStanzaHoverContent(stanzaName: string): string {
  if (stanzaName === 'default') {
    return [
      '### [default]',
      '',
      'Default stanza that applies to **all** sourcetypes.',
      '',
      'Settings here provide baseline configuration that can be overridden by more specific stanzas.',
      '',
      '**Precedence:** Lowest (overridden by `[sourcetype]`, `[host::*]`, and `[source::*]`)',
    ].join('\n');
  }

  if (stanzaName.startsWith('source::')) {
    const pattern = stanzaName.slice('source::'.length);
    return [
      `### [source::${pattern}]`,
      '',
      `Source-based stanza matching source path pattern: \`${pattern}\``,
      '',
      '**Precedence:** Highest — overrides all other stanza types.',
      '',
      '**Pattern syntax:**',
      '- `*` matches any characters within a path segment',
      '- `...` matches any path segments (recursive wildcard)',
      '- More specific patterns take precedence over less specific ones',
    ].join('\n');
  }

  if (stanzaName.startsWith('host::')) {
    const pattern = stanzaName.slice('host::'.length);
    return [
      `### [host::${pattern}]`,
      '',
      `Host-based stanza matching hostname pattern: \`${pattern}\``,
      '',
      '**Precedence:** Overrides `[sourcetype]` and `[default]`, overridden by `[source::*]`.',
      '',
      '**Pattern syntax:**',
      '- `*` matches any characters',
      '- More specific patterns take precedence',
    ].join('\n');
  }

  return [
    `### [${stanzaName}]`,
    '',
    `Sourcetype stanza — applies to events with \`sourcetype=${stanzaName}\`.`,
    '',
    '**Precedence:** Overrides `[default]`, overridden by `[host::*]` and `[source::*]`.',
  ].join('\n');
}
