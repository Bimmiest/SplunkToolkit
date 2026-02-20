import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import './index.css'
import App from './App.tsx'

// Configure Monaco to use the local bundled package instead of CDN
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  },
}
loader.config({ monaco })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
