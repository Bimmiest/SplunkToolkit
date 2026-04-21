import { useRef, useEffect, useCallback } from 'react';
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useAppStore } from '../../store/useAppStore';
import { registerEditor } from './editorRegistry';
import { createCompletionProvider } from '../../monaco/splunkConfCompletion';
import { createHoverProvider } from '../../monaco/splunkConfHover';
import { createFoldingRangeProvider } from '../../monaco/splunkConfFolding';
import { computeDiagnostics } from '../../monaco/splunkConfDiagnostics';

interface SplunkEditorProps {
  value: string;
  onChange: (value: string) => void;
  fileType?: 'props.conf' | 'transforms.conf';
  language?: string;
  onEditorReady?: (editor: editor.IStandaloneCodeEditor) => void;
}

let languageRegistered = false;

export function SplunkEditor({ value, onChange, fileType = 'props.conf', language = 'splunk-conf', onEditorReady }: SplunkEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const theme = useAppStore((s) => s.theme);
  const diagnosticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runDiagnostics = useCallback(() => {
    if (!editorRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;

    const monacoInstance = window.monaco;
    if (!monacoInstance) return;

    const markers = computeDiagnostics(model, fileType);
    monacoInstance.editor.setModelMarkers(model, 'splunk-linter', markers);
  }, [fileType]);

  const handleMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance;
    registerEditor(fileType, editorInstance);
    onEditorReady?.(editorInstance);
    // Run initial diagnostics
    setTimeout(runDiagnostics, 500);
  };

  const handleChange: OnChange = (newValue) => {
    onChange(newValue ?? '');

    // Debounce diagnostics
    if (diagnosticTimerRef.current) {
      clearTimeout(diagnosticTimerRef.current);
    }
    diagnosticTimerRef.current = setTimeout(runDiagnostics, 500);
  };

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({
        theme: theme === 'dark' ? 'splunk-dark' : 'splunk-light',
      });
    }
  }, [theme]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (diagnosticTimerRef.current) {
        clearTimeout(diagnosticTimerRef.current);
      }
    };
  }, []);

  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      onChange={handleChange}
      onMount={handleMount}
      theme={theme === 'dark' ? 'splunk-dark' : 'splunk-light'}
      options={{
        minimap: { enabled: false },
        contextmenu: false,
        wordWrap: 'off',
        lineNumbers: 'on',
        folding: true,
        scrollBeyondLastLine: false,
        fontSize: 14,
        fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
        tabSize: 4,
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: false },
        acceptSuggestionOnEnter: 'off',
        tabCompletion: 'on',
        suggestOnTriggerCharacters: true,
        quickSuggestions: true,
        fixedOverflowWidgets: true,
        padding: { top: 8 },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      }}
      beforeMount={(monaco) => {
        if (!languageRegistered) {
          languageRegistered = true;
          registerSplunkConfLanguage(monaco);
        }
        // Store monaco on window for diagnostics
        window.monaco = monaco;
      }}
    />
  );
}

function registerSplunkConfLanguage(monaco: typeof import('monaco-editor')) {
  monaco.languages.register({ id: 'splunk-conf' });

  monaco.languages.setMonarchTokensProvider('splunk-conf', {
    defaultToken: '',
    tokenPostfix: '.splunk-conf',

    // All known directive keywords
    keywords: [
      'TIME_PREFIX', 'TIME_FORMAT', 'MAX_TIMESTAMP_LOOKAHEAD', 'TZ',
      'DATETIME_CONFIG', 'MAX_DAYS_AGO', 'MAX_DAYS_HENCE',
      'SHOULD_LINEMERGE', 'BREAK_ONLY_BEFORE', 'BREAK_ONLY_BEFORE_DATE',
      'MUST_BREAK_AFTER', 'LINE_BREAKER', 'TRUNCATE',
      'EVENT_BREAKER_ENABLE', 'EVENT_BREAKER',
      'KV_MODE', 'AUTO_KV_JSON', 'INDEXED_EXTRACTIONS',
      'CHARSET', 'ANNOTATE_PUNCT', 'MATCH_LIMIT', 'DEPTH_LIMIT',
      'LEARN_SOURCETYPE', 'SEGMENTATION', 'NO_BINARY_CHECK',
      'REGEX', 'FORMAT', 'SOURCE_KEY', 'DEST_KEY', 'WRITE_META', 'OUTPUT',
      'INGEST_EVAL', 'CLONE_SOURCETYPE',
      'filename', 'match_type', 'default_match', 'max_matches', 'min_matches',
      'MAX_DIFF_SECS_AGO', 'MAX_DIFF_SECS_HENCE',
    ],

    // Keywords whose values are regex patterns
    regexKeywords: [
      'LINE_BREAKER', 'BREAK_ONLY_BEFORE', 'MUST_BREAK_AFTER',
      'EVENT_BREAKER', 'TIME_PREFIX', 'REGEX',
    ],

    evalFunctions: [
      'if', 'case', 'coalesce', 'nullif', 'validate',
      'lower', 'upper', 'len', 'substr', 'replace', 'trim', 'ltrim', 'rtrim',
      'urldecode', 'split', 'mvjoin', 'tonumber', 'tostring', 'typeof',
      'isnull', 'isnotnull', 'isint', 'isnum',
      'abs', 'ceiling', 'ceil', 'floor', 'round', 'sqrt', 'pow',
      'log', 'ln', 'exp', 'pi', 'min', 'max', 'random',
      'mvcount', 'mvindex', 'mvfilter', 'mvappend', 'mvdedup', 'mvfind', 'mvsort', 'mvzip',
      'md5', 'sha1', 'sha256', 'sha512',
      'now', 'time', 'strftime', 'strptime', 'relative_time',
      'like', 'match', 'cidrmatch', 'null',
    ],

    tokenizer: {
      root: [
        [/^[#;].*$/, 'comment'],
        [/^\[/, { token: 'tag.bracket', next: '@stanza' }],
        // EVAL directives → evalValue state (SPL expressions)
        [/^(EVAL)(-[^\s=]+)?(\s*=)/,
          ['keyword', 'variable.name', { token: 'delimiter', next: '@evalValue' }]],
        // INGEST_EVAL → evalValue state (semicolon-separated SPL expressions)
        [/^(INGEST_EVAL)(\s*=)/,
          ['keyword', { token: 'delimiter', next: '@evalValue' }]],
        // EXTRACT/SEDCMD directives → regexValue state (regex patterns)
        [/^(EXTRACT|SEDCMD)(-[^\s=]+)?(\s*=)/,
          ['keyword', 'variable.name', { token: 'delimiter', next: '@regexValue' }]],
        // FIELDALIAS → fieldAliasValue state (sourceField AS aliasField)
        [/^(FIELDALIAS)(-[^\s=]+)?(\s*=)/,
          ['keyword', 'variable.name', { token: 'delimiter', next: '@fieldAliasValue' }]],
        // REPORT/TRANSFORMS → listValue state (comma-separated stanza refs)
        [/^(REPORT|TRANSFORMS)(-[^\s=]+)?(\s*=)/,
          ['keyword', 'variable.name', { token: 'delimiter', next: '@listValue' }]],
        // LOOKUP → lookupValue state
        [/^(LOOKUP)(-[^\s=]+)?(\s*=)/,
          ['keyword', 'variable.name', { token: 'delimiter', next: '@lookupValue' }]],
        // Standard keywords — route regex-valued ones to regexValue
        [/^([A-Z_][A-Z_0-9]*)(\s*=)/, {
          cases: {
            '$1@regexKeywords': ['keyword', { token: 'delimiter', next: '@regexValue' }],
            '$1@keywords': ['keyword', { token: 'delimiter', next: '@value' }],
            '@default': ['identifier', { token: 'delimiter', next: '@value' }],
          },
        }],
        [/^([a-z_][a-z_0-9]*)(\s*=)/, ['keyword.other', { token: 'delimiter', next: '@value' }]],
        [/=\s*/, { token: 'delimiter', next: '@value' }],
        [/./, 'string'],
      ],
      stanza: [
        [/^./, { token: '@rematch', next: '@pop' }],
        [/[^\]]+/, 'tag'],
        [/\]/, { token: 'tag.bracket', next: '@pop' }],
      ],
      // Generic values (numbers, booleans, strftime, plain strings)
      value: [
        [/^./, { token: '@rematch', next: '@pop' }],
        [/\\\s*$/, { token: 'escape', next: '@valueCont' }],
        [/\b(true|false)\b/i, 'constant.language'],
        [/\b\d+(\.\d+)?\b/, 'number'],
        [/%\d+[Nn]/, 'type'],
        [/%[YymdHeIMSpbBaAZzsTF]/, 'type'],
        [/./, 'string'],
      ],
      // Continuation states: same rules but only pop when a new directive starts (non-whitespace at line start)
      valueCont: [
        [/^\S/, { token: '@rematch', next: '@pop' }],
        [/\\\s*$/, 'escape'],
        [/\b(true|false)\b/i, 'constant.language'],
        [/\b\d+(\.\d+)?\b/, 'number'],
        [/%\d+[Nn]/, 'type'],
        [/%[YymdHeIMSpbBaAZzsTF]/, 'type'],
        [/./, 'string'],
      ],
      // FIELDALIAS values: sourceField AS aliasField [, sourceField AS aliasField ...]
      fieldAliasValue: [
        [/^./, { token: '@rematch', next: '@pop' }],
        [/\\\s*$/, { token: 'escape', next: '@fieldAliasValueCont' }],
        [/\b(AS|as|As)\b/, 'keyword'],
        [/,/, 'delimiter'],
        [/\s+/, ''],
        [/[a-zA-Z_][\w.{}*-]*/, 'variable'],
      ],
      fieldAliasValueCont: [
        [/^\S/, { token: '@rematch', next: '@pop' }],
        [/\\\s*$/, 'escape'],
        [/\b(AS|as|As)\b/, 'keyword'],
        [/,/, 'delimiter'],
        [/\s+/, ''],
        [/[a-zA-Z_][\w.{}*-]*/, 'variable'],
      ],
      // Comma-separated stanza/transform references (REPORT, TRANSFORMS)
      listValue: [
        [/^./, { token: '@rematch', next: '@pop' }],
        [/\\\s*$/, { token: 'escape', next: '@listValueCont' }],
        [/,/, 'delimiter'],
        [/\s+/, ''],
        [/[^\s,\\]+/, 'tag'],
      ],
      listValueCont: [
        [/^\S/, { token: '@rematch', next: '@pop' }],
        [/\\\s*$/, 'escape'],
        [/,/, 'delimiter'],
        [/\s+/, ''],
        [/[^\s,\\]+/, 'tag'],
      ],
      // LOOKUP values: lookup_name field1 (AS alias1)? field2 (AS alias2)? ...
      lookupValue: [
        [/^./, { token: '@rematch', next: '@pop' }],
        [/\\\s*$/, { token: 'escape', next: '@lookupValueCont' }],
        [/\b(AS|as|As)\b/, 'keyword'],
        [/\b(OUTPUT|OUTPUTNEW|output|outputnew)\b/, 'keyword'],
        [/,/, 'delimiter'],
        [/\s+/, ''],
        [/[a-zA-Z_][\w.{}*-]*/, 'variable'],
      ],
      lookupValueCont: [
        [/^\S/, { token: '@rematch', next: '@pop' }],
        [/\\\s*$/, 'escape'],
        [/\b(AS|as|As)\b/, 'keyword'],
        [/\b(OUTPUT|OUTPUTNEW|output|outputnew)\b/, 'keyword'],
        [/,/, 'delimiter'],
        [/\s+/, ''],
        [/[a-zA-Z_][\w.{}*-]*/, 'variable'],
      ],
      // Regex pattern values (EXTRACT, LINE_BREAKER, REGEX, etc.)
      regexValue: [
        [/^./, { token: '@rematch', next: '@pop' }],
        [/\\\s*$/, { token: 'escape', next: '@regexValueCont' }],
        [/\b(true|false)\b/i, 'constant.language'],
        [/\b\d+(\.\d+)?\b/, 'number'],
        [/\(\?P?<\w+>/, 'regexp.escape'],
        [/\(\?[=!:]/, 'regexp.escape'],
        [/\\[rntdwsDWsSbB\\/.^$*+?()[\]{}|]/, 'regexp.escape'],
        [/[[\](){}|^$.*+?]/, 'regexp'],
        [/\$\d+/, 'variable.value'],
        [/./, 'string'],
      ],
      regexValueCont: [
        [/^\S/, { token: '@rematch', next: '@pop' }],
        [/\\\s*$/, 'escape'],
        [/\b(true|false)\b/i, 'constant.language'],
        [/\b\d+(\.\d+)?\b/, 'number'],
        [/\(\?P?<\w+>/, 'regexp.escape'],
        [/\(\?[=!:]/, 'regexp.escape'],
        [/\\[rntdwsDWsSbB\\/.^$*+?()[\]{}|]/, 'regexp.escape'],
        [/[[\](){}|^$.*+?]/, 'regexp'],
        [/\$\d+/, 'variable.value'],
        [/./, 'string'],
      ],
      // EVAL expressions (SPL eval language)
      evalValue: [
        [/^./, { token: '@rematch', next: '@pop' }],
        [/\\\s*$/, { token: 'escape', next: '@evalValueCont' }],
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'variable'],
        [/\b(true|false|null)\b/i, 'constant.language'],
        [/\b(AND|OR|NOT)\b/i, 'keyword'],
        [/\b\d+(\.\d+)?\b/, 'number'],
        [/==|!=|>=|<=|&&|\|\||\./, 'operator'],
        [/[+\-*/%<>=!]/, 'operator'],
        [/[(),;]/, 'delimiter'],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@evalFunctions': 'support.function',
            '@default': 'variable',
          },
        }],
        [/./, ''],
      ],
      evalValueCont: [
        [/^\S/, { token: '@rematch', next: '@pop' }],
        [/\\\s*$/, 'escape'],
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'variable'],
        [/\b(true|false|null)\b/i, 'constant.language'],
        [/\b(AND|OR|NOT)\b/i, 'keyword'],
        [/\b\d+(\.\d+)?\b/, 'number'],
        [/==|!=|>=|<=|&&|\|\||\./, 'operator'],
        [/[+\-*/%<>=!]/, 'operator'],
        [/[(),;]/, 'delimiter'],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@evalFunctions': 'support.function',
            '@default': 'variable',
          },
        }],
        [/./, ''],
      ],
    },
  });

  // Register providers
  monaco.languages.registerCompletionItemProvider('splunk-conf', createCompletionProvider('props.conf'));
  monaco.languages.registerCompletionItemProvider('splunk-conf', createCompletionProvider('transforms.conf'));
  monaco.languages.registerHoverProvider('splunk-conf', createHoverProvider('props.conf'));
  monaco.languages.registerHoverProvider('splunk-conf', createHoverProvider('transforms.conf'));
  monaco.languages.registerFoldingRangeProvider('splunk-conf', createFoldingRangeProvider());

  // Light theme
  monaco.editor.defineTheme('splunk-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '71717a', fontStyle: 'italic' },   /* zinc-500 */
      { token: 'tag', foreground: '7c3aed' },                            /* violet-700 */
      { token: 'tag.bracket', foreground: '7c3aed' },
      { token: 'keyword', foreground: '4f46e5' },                        /* indigo-600 */
      { token: 'keyword.other', foreground: '4f46e5' },
      { token: 'variable.name', foreground: 'c2410c' },                  /* orange-700 */
      { token: 'delimiter', foreground: '27272a' },
      { token: 'string', foreground: '3730a3' },                         /* indigo-800 */
      { token: 'number', foreground: '047857' },                         /* emerald-700 */
      { token: 'constant.language', foreground: '4f46e5' },
      { token: 'regexp', foreground: 'b91c1c' },                         /* red-700 */
      { token: 'regexp.escape', foreground: 'b91c1c', fontStyle: 'bold' },
      { token: 'type', foreground: '0f766e' },                           /* teal-700 */
      { token: 'variable.value', foreground: 'c2410c' },
      { token: 'identifier', foreground: '6d28d9' },                     /* violet-700 */
      { token: 'support.function', foreground: '92400e' },               /* amber-800 */
      { token: 'operator', foreground: '27272a' },
      { token: 'variable', foreground: 'c2410c' },
      { token: 'escape', foreground: '71717a', fontStyle: 'bold' },
    ],
    colors: {
      'editor.background': '#ffffff',        /* --color-bg-elevated */
      'editor.foreground': '#27272a',
      'editorLineNumber.foreground': '#a1a1aa',
      'editorLineNumber.activeForeground': '#27272a',
      'editor.selectionBackground': '#6366f130',
      'editor.lineHighlightBackground': '#f4f4f5',  /* --color-bg-secondary */
      'editorCursor.foreground': '#6366f1',
    },
  });

  // Dark theme
  monaco.editor.defineTheme('splunk-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
      { token: 'tag', foreground: 'c586c0' },
      { token: 'tag.bracket', foreground: 'c586c0' },
      { token: 'keyword', foreground: '818cf8' },      /* indigo-400 */
      { token: 'keyword.other', foreground: '818cf8' },
      { token: 'variable.name', foreground: 'fb923c' }, /* orange-400 */
      { token: 'delimiter', foreground: 'e4e4e7' },
      { token: 'string', foreground: 'a5b4fc' },        /* indigo-300 */
      { token: 'number', foreground: '34d399' },        /* emerald-400 */
      { token: 'constant.language', foreground: '818cf8' },
      { token: 'regexp', foreground: 'f87171' },        /* red-400 */
      { token: 'regexp.escape', foreground: 'f87171', fontStyle: 'bold' },
      { token: 'type', foreground: '2dd4bf' },          /* teal-400 */
      { token: 'variable.value', foreground: 'fbbf24' },
      { token: 'identifier', foreground: '93c5fd' },
      { token: 'support.function', foreground: 'fbbf24' },
      { token: 'operator', foreground: 'e4e4e7' },
      { token: 'variable', foreground: '93c5fd' },
      { token: 'escape', foreground: '6a9955', fontStyle: 'bold' },
    ],
    colors: {
      'editor.background': '#303036',        /* --color-bg-elevated */
      'editor.foreground': '#f4f4f5',
      'editorLineNumber.foreground': '#71717a',
      'editorLineNumber.activeForeground': '#f4f4f5',
      'editor.selectionBackground': '#818cf850',
      'editor.inactiveSelectionBackground': '#818cf830',
      'editor.selectionHighlightBackground': '#818cf825',
      'editor.lineHighlightBackground': '#27272a',  /* --color-bg-secondary */
      'editorCursor.foreground': '#818cf8',
    },
  });
}
