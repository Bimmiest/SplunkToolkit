import type { languages, editor, Position, CancellationToken } from 'monaco-editor';
import { getDirectiveInfo, getClassBasedDirectiveBase } from '../engine/directiveRegistry';
import { classifyStanza } from '../engine/stanzaRegistry';
import { getStagesForDirective } from '../engine/pipelineStages';
import { openDictionaryCommandUri } from './dictionaryCommand';

export function createHoverProvider(fileType: 'props.conf' | 'transforms.conf'): languages.HoverProvider {
  return {
    provideHover(
      model: editor.ITextModel,
      position: Position,
      _token: CancellationToken
    ): languages.ProviderResult<languages.Hover> {
      const line = model.getLineContent(position.lineNumber);

      // Check if hovering over a stanza header. Trim first: confParser's STANZA_RE
      // tolerates surrounding whitespace, so matching the raw line made hover
      // stricter than parsing and `[foo] ` got no hover at all.
      const stanzaMatch = line.trim().match(/^\[(.+)\]$/);
      if (stanzaMatch) {
        const stanzaName = stanzaMatch[1] ?? '';
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
            // `isTrusted` is what lets the "Open in dictionary" command link
            // work; Monaco ignores `command:` URIs in untrusted Markdown. The
            // content is built here from the local registry, never from the
            // document, so nothing user-authored reaches the link.
            contents: [{ value: formatDirectiveHover(info, key), isTrusted: true }],
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

function formatDirectiveHover(info: import('../engine/directiveRegistry').DirectiveInfo, actualKey: string): string {
  const parts: string[] = [];

  parts.push(`### ${actualKey}`);

  if (info.isClassBased && actualKey.includes('-')) {
    const className = actualKey.split('-').slice(1).join('-');
    parts.push(`*Class-based directive* (\`${info.key}-<${className}>\`)`);
  }

  parts.push('');
  parts.push(info.description);
  parts.push('');

  // Said before the specification table rather than after it: whether the
  // preview honours the directive changes how everything below should be read.
  if (info.support !== 'simulated') {
    const tracking = info.supportIssue ? ` Tracked as #${info.supportIssue}.` : '';
    parts.push(
      info.support === 'ignored'
        ? `> ⚠️ **Not simulated.** ${info.supportNote ?? ''}${tracking}`.trim()
        : `> ℹ️ **Outside the simulation.** ${info.supportNote ?? ''}`.trim(),
    );
    parts.push('');
  } else if (info.supportNote) {
    parts.push(`> **Partly simulated.** ${info.supportNote}`);
    parts.push('');
  }

  parts.push('| Property | Value |');
  parts.push('|----------|-------|');
  parts.push(`| **Category** | ${info.category} |`);
  parts.push(`| **Phase** | ${info.phase} |`);
  parts.push(`| **Type** | ${info.valueType} |`);
  parts.push(`| **Default** | \`${info.defaultValue || '(none)'}\` |`);
  parts.push(`| **Applies to** | ${info.appliesTo} |`);

  const stages = getStagesForDirective(info.key);
  if (stages.length > 0) {
    parts.push(`| **Stage** | ${stages.map((s) => `${s.step}. ${s.name}`).join(', ')} |`);
  }

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

  // Links to the canonical key, not `actualKey`: the dictionary documents
  // `EXTRACT`, and "EXTRACT-client_ip" is one instance of it.
  parts.push('');
  parts.push(`[Open in dictionary](${openDictionaryCommandUri(info.key)})`);

  return parts.join('\n');
}

/**
 * Render a stanza header hover from the shared stanza registry, so this and the
 * dictionary describe precedence identically.
 */
function getStanzaHoverContent(stanzaName: string): string {
  const { kind, pattern } = classifyStanza(stanzaName);

  const parts: string[] = [`### [${stanzaName}]`, '', kind.description, ''];

  if (kind.id === 'sourcetype' && pattern) {
    parts.push(`Applies to events with \`sourcetype=${pattern}\`.`, '');
  } else if (pattern) {
    parts.push(`Matching pattern: \`${pattern}\``, '');
  }

  parts.push(`**Precedence:** ${kind.precedence}`);

  if (kind.patternSyntax.length > 0) {
    parts.push('', '**Pattern syntax:**');
    for (const line of kind.patternSyntax) parts.push(`- ${line}`);
  }

  return parts.join('\n');
}
