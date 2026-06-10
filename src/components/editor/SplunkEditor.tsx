import { useRef, useEffect, useCallback } from 'react';
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useAppStore } from '../../store/useAppStore';
import { registerEditor, unregisterEditor } from './editorRegistry';
import { computeDiagnostics } from '../../monaco/splunkConfDiagnostics';
import { ensureSplunkMonaco, PROPS_LANGUAGE_ID, TRANSFORMS_LANGUAGE_ID } from './splunkMonacoSetup';

interface SplunkEditorProps {
  value: string;
  onChange: (value: string) => void;
  fileType?: 'props.conf' | 'transforms.conf';
  /** Override the Monaco language ID. Defaults to the one matching `fileType`. */
  language?: string;
  onEditorReady?: (editor: editor.IStandaloneCodeEditor) => void;
}

export function SplunkEditor({ value, onChange, fileType = 'props.conf', language, onEditorReady }: SplunkEditorProps) {
  // Each conf file maps to its own language so it only offers its own directives (UI-4).
  const resolvedLanguage = language ?? (fileType === 'transforms.conf' ? TRANSFORMS_LANGUAGE_ID : PROPS_LANGUAGE_ID);
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
    // Run initial diagnostics (timer cleared on unmount alongside the change timer).
    diagnosticTimerRef.current = setTimeout(runDiagnostics, 500);
  };

  const handleChange: OnChange = (newValue) => {
    onChange(newValue ?? '');

    // Debounce diagnostics
    if (diagnosticTimerRef.current) {
      clearTimeout(diagnosticTimerRef.current);
    }
    diagnosticTimerRef.current = setTimeout(runDiagnostics, 500);
  };

  // Theme is applied through the <Editor theme=…> prop below (which calls
  // monaco.editor.setTheme); a separate updateOptions({ theme }) effect was
  // redundant — updateOptions doesn't even carry the global theme.

  // Cleanup on unmount: clear the diagnostics timer and remove this editor from the
  // registry so consumers can't act on a disposed instance (e.g. after a collapse or
  // mobile-layout switch).
  useEffect(() => {
    return () => {
      if (diagnosticTimerRef.current) {
        clearTimeout(diagnosticTimerRef.current);
      }
      if (editorRef.current) {
        unregisterEditor(fileType, editorRef.current);
      }
    };
  }, [fileType]);

  return (
    <Editor
      height="100%"
      language={resolvedLanguage}
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
      beforeMount={ensureSplunkMonaco}
    />
  );
}
