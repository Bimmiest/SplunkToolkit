import type { languages, editor, Position, CancellationToken } from 'monaco-editor';
import { getDirectivesForFile, getDirectivesByCategory, type DirectiveInfo } from './directiveRegistry';

export function createCompletionProvider(fileType: 'props.conf' | 'transforms.conf'): languages.CompletionItemProvider {
  return {
    triggerCharacters: ['=', '[', '\n'],

    provideCompletionItems(
      model: editor.ITextModel,
      position: Position,
      _context: languages.CompletionContext,
      _token: CancellationToken
    ): languages.ProviderResult<languages.CompletionList> {
      const line = model.getLineContent(position.lineNumber);
      const textBefore = line.substring(0, position.column - 1).trimStart();

      // Inside stanza brackets - suggest stanza types
      if (textBefore.startsWith('[')) {
        return {
          suggestions: getStanzaSuggestions(model, position),
        };
      }

      // After = sign - suggest values for the directive
      const eqIdx = line.indexOf('=');
      if (eqIdx >= 0 && position.column - 1 > eqIdx) {
        const key = line.substring(0, eqIdx).trim();
        return {
          suggestions: getValueSuggestions(key, model, position, fileType),
        };
      }

      // At start of line - suggest directive keys
      return {
        suggestions: getDirectiveSuggestions(model, position, fileType),
      };
    },
  };
}

function getStanzaSuggestions(model: editor.ITextModel, position: Position): languages.CompletionItem[] {
  const range = getWordRange(model, position);
  return [
    {
      label: 'default',
      kind: 5, // Enum
      detail: 'Default stanza - applies to all sourcetypes',
      insertText: 'default]',
      range,
    },
    {
      label: 'source::',
      kind: 5,
      detail: 'Source-based stanza (highest precedence)',
      insertText: 'source::${1:path}]',
      insertTextRules: 4, // InsertAsSnippet
      range,
    },
    {
      label: 'host::',
      kind: 5,
      detail: 'Host-based stanza',
      insertText: 'host::${1:hostname}]',
      insertTextRules: 4,
      range,
    },
  ];
}

function getDirectiveSuggestions(
  model: editor.ITextModel,
  position: Position,
  fileType: 'props.conf' | 'transforms.conf'
): languages.CompletionItem[] {
  const directives = getDirectivesForFile(fileType);
  const categories = getDirectivesByCategory(fileType);
  const range = getWordRange(model, position);

  const items: languages.CompletionItem[] = [];

  // Group by category for better organization
  let sortOrder = 0;
  for (const [category, categoryDirectives] of categories) {
    for (const dir of categoryDirectives) {
      const item = directiveToCompletionItem(dir, range, category, sortOrder++);
      items.push(item);

      // For class-based directives, also add the pattern with placeholder
      if (dir.isClassBased) {
        items.push({
          label: `${dir.key}-`,
          kind: 14, // Snippet
          detail: `${dir.key}-<class> (${category})`,
          documentation: dir.description,
          insertText: `${dir.key}-\${1:classname} = \${2:value}`,
          insertTextRules: 4,
          sortText: String(sortOrder++).padStart(4, '0'),
          range,
        });
      }
    }
  }

  // Also add directives not categorized
  for (const dir of directives) {
    if (!items.some((i) => i.label === dir.key)) {
      items.push(directiveToCompletionItem(dir, range, dir.category, sortOrder++));
    }
  }

  return items;
}

function directiveToCompletionItem(
  dir: DirectiveInfo,
  range: languages.CompletionItem['range'],
  category: string,
  sortOrder: number
): languages.CompletionItem {
  const insertText = dir.isClassBased
    ? `${dir.key}-\${1:classname} = \${2:value}`
    : `${dir.key} = \${1:${dir.defaultValue || 'value'}}`;

  return {
    label: dir.key,
    kind: dir.isClassBased ? 14 : 9, // Snippet or Property
    detail: `${category} (${dir.phase})`,
    documentation: {
      value: [
        `**${dir.key}**`,
        '',
        dir.description,
        '',
        `**Default:** \`${dir.defaultValue || '(none)'}\``,
        '',
        `**Example:** \`${dir.example}\``,
        '',
        `**Phase:** ${dir.phase}`,
        `**Type:** ${dir.valueType}`,
      ].join('\n'),
      isTrusted: true,
    },
    insertText,
    insertTextRules: 4, // InsertAsSnippet
    sortText: String(sortOrder).padStart(4, '0'),
    range,
  };
}

function getValueSuggestions(
  key: string,
  model: editor.ITextModel,
  position: Position,
  fileType: 'props.conf' | 'transforms.conf'
): languages.CompletionItem[] {
  const directives = getDirectivesForFile(fileType);
  const baseKey = key.includes('-') ? key.split('-')[0] : key;
  const dir = directives.find((d) => d.key === key || d.key === baseKey);
  if (!dir) return [];

  const range = getWordRange(model, position);
  const items: languages.CompletionItem[] = [];

  if (dir.valueType === 'boolean') {
    items.push(
      { label: 'true', kind: 12, insertText: 'true', range, detail: 'Boolean true' },
      { label: 'false', kind: 12, insertText: 'false', range, detail: 'Boolean false' },
    );
  }

  if (dir.valueType === 'enum' && dir.enumValues) {
    for (const val of dir.enumValues) {
      items.push({
        label: val,
        kind: 12,
        insertText: val,
        range,
        detail: `Valid value for ${dir.key}`,
      });
    }
  }

  // Suggest common strftime tokens for TIME_FORMAT
  if (dir.valueType === 'strftime') {
    const strftimeTokens = [
      { token: '%Y-%m-%dT%H:%M:%S', desc: 'ISO 8601 datetime' },
      { token: '%Y-%m-%d %H:%M:%S', desc: 'Standard datetime' },
      { token: '%b %d %H:%M:%S', desc: 'Syslog format' },
      { token: '%s', desc: 'Epoch seconds' },
      { token: '%Y-%m-%dT%H:%M:%S.%3N%z', desc: 'ISO 8601 with milliseconds and timezone' },
    ];
    for (const { token, desc } of strftimeTokens) {
      items.push({
        label: token,
        kind: 21, // Constant
        insertText: token,
        range,
        detail: desc,
      });
    }
  }

  return items;
}

function getWordRange(model: editor.ITextModel, position: Position): languages.CompletionItem['range'] {
  const word = model.getWordAtPosition(position);
  if (word) {
    return {
      startLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endLineNumber: position.lineNumber,
      endColumn: word.endColumn,
    };
  }
  return {
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  };
}
