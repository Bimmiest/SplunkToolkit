declare global {
  /**
   * The Monaco instance the app actually loads: the slim `editor.api` entry
   * point (see main.tsx), which is also the type `@monaco-editor/react`
   * hands to `beforeMount`. Use this everywhere we pass the runtime instance.
   */
  type MonacoApi = typeof import('monaco-editor/esm/vs/editor/editor.api');

  interface Window {
    monaco?: MonacoApi;
  }
}

export {};
