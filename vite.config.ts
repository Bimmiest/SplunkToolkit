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
          // Group the slim editor.api entry — NOT the `monaco-editor` barrel,
          // which would force the ~80 basic-languages and the TS/JSON/CSS/HTML
          // language services (and their web workers) back into the graph even
          // though nothing imports them. See TOOL-2 / main.tsx.
          'monaco-editor': ['monaco-editor/esm/vs/editor/editor.api'],
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },
})
