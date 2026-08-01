import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          // Group the slim editor.api entry plus the editor contributions —
          // NOT the `monaco-editor` barrel, which would force the ~80
          // basic-languages and the TS/JSON/CSS/HTML language services (and
          // their web workers) back into the graph even though nothing imports
          // them. See TOOL-2 / main.tsx.
          //
          // editor.all must be named here alongside editor.api: it is a
          // separate entry point, so without it every contribution lands in the
          // app chunk instead — a megabyte of Monaco that then reloads on any
          // application change.
          'monaco-editor': [
            'monaco-editor/esm/vs/editor/editor.api',
            'monaco-editor/esm/vs/editor/editor.all.js',
          ],
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },
})
