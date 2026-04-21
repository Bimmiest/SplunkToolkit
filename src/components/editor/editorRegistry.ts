import type { editor } from 'monaco-editor';

const _editors = new Map<string, editor.IStandaloneCodeEditor>();

export function registerEditor(file: string, instance: editor.IStandaloneCodeEditor): void {
  _editors.set(file, instance);
}

export function getEditor(file: string): editor.IStandaloneCodeEditor | undefined {
  return _editors.get(file);
}
