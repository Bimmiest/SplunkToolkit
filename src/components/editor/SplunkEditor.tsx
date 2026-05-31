import { useRef, useEffect, useCallback } from 'react';
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useAppStore } from '../../store/useAppStore';
import { registerEditor } from './editorRegistry';
import { computeDiagnostics } from '../../monaco/splunkConfDiagnostics';
import { ensureSplunkMonaco } from './splunkMonacoSetup';

interface SplunkEditorProps {
  value: string;
  onChange: (value: string) => void;
  fileType?: 'props.conf' | 'transforms.conf';
  language?: string;
  onEditorReady?: (editor: editor.IStandaloneCodeEditor) => void;
}

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
      beforeMount={ensureSplunkMonaco}
    />
  );
}
