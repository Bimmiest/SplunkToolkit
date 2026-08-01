import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import './index.css'
import App from './App.tsx'

// Point Monaco at the locally bundled worker instead of a CDN. The editor
// instance itself is imported directly by MonacoEditor.tsx — there is no
// runtime loader to configure.
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={100}>
      <App />
    </RadixTooltip.Provider>
  </StrictMode>,
)
