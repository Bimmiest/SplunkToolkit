import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
// Import the editor API only — NOT the `monaco-editor` barrel (editor.main),
// which eagerly bundles ~80 basic-languages and the TypeScript/JSON/CSS/HTML
// language services (their main-thread modes *and* web workers, the ts.worker
// alone being ~7 MB). This app registers its own `splunk-conf` language, so it
// needs none of them; editor.api keeps every editor contribution we do use
// (find, folding, suggest, hover).
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import * as RadixTooltip from '@radix-ui/react-tooltip'
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
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={100}>
      <App />
    </RadixTooltip.Provider>
  </StrictMode>,
)
