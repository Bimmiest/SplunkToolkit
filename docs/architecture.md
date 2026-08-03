# Architecture notes

Contributor-facing internals. The user-facing architecture — pipeline order, stanza precedence, layout — is in the [README](../README.md).

## State management

Single Zustand store (`src/store/useAppStore.ts`). The store is flat — components subscribe to individual slices rather than reading the whole store.

```
rawData / metadata / propsConf / transformsConf     User inputs (ephemeral)
processingResult / validationDiagnostics            Pipeline output
lastProcessingMs / workerStatus                     StatusBar telemetry
theme / activeOutputTab / collapsedPanels / ...     UI state
activeView / dictionarySelection                    Rail view + dictionary deep link
settings                                            Simulator options (e.g. perEventPipeline)
```

localStorage is limited to UI layout state (split-pane sizes, seen-intro flag, theme), read inside try/catch with typed fallbacks. Raw logs and configuration are not persisted — a refresh clears them.

Monaco editor instances live in a module-level `Map` in `editorRegistry.ts`, not in the Zustand store.

## Monaco bundling

Monaco's widgets (hover, suggest, folding, find, multi-cursor) are *contributions*, imported separately from the API surface in `MonacoEditor.tsx` via `editor.all`. `editor.api` alone registers providers that nothing ever renders. `vite.config.ts` groups the slim `esm/vs` tree both entries pull in via `codeSplitting` (Rolldown's replacement for `manualChunks` — it claims modules the graph already reached rather than naming ids to pull in, so `editor.all` is held there by its own import in `MonacoEditor.tsx`). A bad split type-checks and builds, then fails to mount an editor — which is one of the things the e2e suite exists to catch (see the README's Tests section).

## Accessibility

- Skip-to-content link (visible on focus).
- Semantic HTML (`<main>`, `<header>`, proper heading hierarchy).
- WAI-ARIA tablist: `role="tablist"` / `role="tab"` / `role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`.
- Arrow keys navigate tabs; Home/End jump to first/last. The activity rail is vertical and declares `aria-orientation`.
- The rail's buttons carry `aria-label`, not just a tooltip: they have no visible text, and a Radix tooltip contributes `aria-describedby`, which supplements an accessible name rather than supplying one.
- The dictionary list is a `role="listbox"` driven by `aria-activedescendant`, so one Tab stop covers 80-odd rows.
- All inputs have associated `<label>` via `htmlFor`/`id`.
- `focus-visible:ring-2` on all interactive elements.
- Panel-level `ErrorBoundary` with "Try Again" recovery.
