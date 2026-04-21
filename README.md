# Splunk Toolkit

Browser-based simulator for Splunk's `props.conf` and `transforms.conf` processing pipeline. All simulation runs in the browser; no backend, no network calls, no persisted user data.

## Commands

```bash
npm install
npm run dev          # Dev server on http://localhost:5173
npm run build        # tsc -b && vite build → dist/
npm run preview      # Serve production build
npm run lint         # ESLint
npm test             # vitest (one-shot)
npm run test:watch   # vitest watch mode
```

## Architecture

Input (raw log + metadata + props.conf + transforms.conf) flows through a single Zustand store. `useProcessingPipeline` debounces changes 300 ms, posts a request to a Web Worker running the full simulation, and writes the result back. A 5 s watchdog kills hung workers and replays the last in-flight request on restart. Each processor is wrapped in `safeProcessor()` — failures record a diagnostic and return the events unchanged rather than crashing the pipeline.

### Processing order

Runs in Splunk's actual order.

**Index-time**
1. Line breaking — `LINE_BREAKER`, `SHOULD_LINEMERGE`, `BREAK_ONLY_BEFORE`, `MUST_BREAK_AFTER`
2. Truncation — `TRUNCATE`
3. Timestamp extraction — `TIME_PREFIX`, `TIME_FORMAT`, `MAX_TIMESTAMP_LOOKAHEAD`, `TZ`
4. Indexed extractions — `INDEXED_EXTRACTIONS` (json, csv, tsv, psv, w3c)
5. Sed commands — `SEDCMD-<class>`
6. Transforms — `TRANSFORMS-<class>`
7. Ingest eval — `INGEST_EVAL` (from transforms.conf)

**Search-time**
8. Field extraction — `EXTRACT-<class>`
9. KV mode — `KV_MODE` (auto, auto_escaped, json, xml, multi)
10. Report transforms — `REPORT-<class>`
11. Field aliases — `FIELDALIAS-<class>`
12. Eval — `EVAL-<class>`

### Stanza precedence

`[source::<pattern>]` > `[host::<pattern>]` > `[<sourcetype>]` > `[default]`. Within a type, more specific patterns win. Directives from all matching stanzas merge in precedence order.

### Layout

Header, two-panel split (inputs left, output right), bottom status bar. The left column stacks Raw log → Metadata → props.conf → transforms.conf in a resizable group; editors collapse to fixed-height bars at the bottom so the resize handle reclaims their space. Each major panel is wrapped in an `ErrorBoundary`.

**Keyboard:** `Ctrl/Cmd+K` opens the command palette (examples, navigate, actions). The header info button (ⓘ) opens a slide-out reference to the 11 pipeline stages.

**Status bar:** worker status, pipeline timing, event count, distinct-field count, error/warning counts, and a "Per-event pipeline" chip when that setting is on.

## Project structure

```
src/
├── engine/                    # Splunk simulation (pure logic, no React)
│   ├── types.ts               # SplunkEvent, ProcessingResult, ConfDirective
│   ├── pipeline.ts            # runPipeline() — sole entry point
│   ├── pipelineWorker.ts      # Web Worker wrapper
│   ├── parser/
│   │   ├── confParser.ts      # INI parser → ParsedConf
│   │   └── stanzaMatcher.ts   # Precedence-based stanza matching
│   ├── processors/            # One file per processing stage
│   ├── transforms/            # regexTransform, destKeyRouter, ingestEval
│   ├── cim/                   # cimModels.ts + cimModelsData.ts (16 models)
│   └── utils/
│       └── flattenJson.ts     # With prototype-pollution guard
│
├── monaco/                    # Monaco language support
│   ├── directiveRegistry.ts   # 45+ directive entries (drives all three features)
│   ├── splunkConfCompletion.ts
│   ├── splunkConfHover.ts
│   ├── splunkConfFolding.ts
│   └── splunkConfDiagnostics.ts
│
├── store/useAppStore.ts       # Zustand store (flat; subscribe per slice)
├── hooks/                     # useProcessingPipeline, useDebounce, useTheme, usePagination
├── utils/                     # splunkRegex, strftime, diffEngine, fieldHighlight
│
└── components/
    ├── layout/                # AppShell, Header, StatusBar
    ├── raw/                   # RawPanel (Monaco plaintext)
    ├── metadata/              # MetadataPanel
    ├── editor/                # SplunkEditor + props/transforms editors, editorRegistry
    ├── preview/
    │   ├── PreviewPanel.tsx   # Output container
    │   ├── PreviewFilterBar.tsx
    │   └── tabs/              # Raw, Timestamp, Highlighted, Diff, Regex,
    │       └── shared/        #   CimModels, Fields, Transforms, Metadata
    ├── settings/              # SettingsPanel (gear in header)
    ├── onboarding/            # FirstRunBanner
    ├── help/                  # HelpPanel (pipeline reference slide-out)
    └── ui/                    # Tabs, Badge, Tooltip, CommandPalette, etc.
```

## Output tabs

**Top-level:** Preview, CIM Models, Fields, Pipeline, Architecture.

**Preview sub-tabs** (order: Raw → Timestamp → Extractions → Diff → Regex):

| Sub-tab | Shows |
|---|---|
| Raw | Events after line/event breaking, with line numbers and timestamp regions. Truncated events carry a `Truncated` badge; expand/collapse handles long events. |
| Timestamp | Matched prefix, format pattern, and parsed `_time` per event. |
| Extractions | Field extractions inline within `_raw`, classified as auto (KV_MODE / INDEXED_EXTRACTIONS), manual (EXTRACT / REPORT / TRANSFORMS / SEDCMD), or calc (EVAL). Filter pills: `Auto / Manual / Calculated / All`. A collapsible sidebar supports search, hover-focus, and pin-to-filter. |
| Diff | Character-level unified diff between original raw data and processed `_raw`. |
| Regex | Interactive regex tester against event text; shows matches only, with empty-state prompt when no pattern is entered. |

**Field highlighting** prefers authoritative byte offsets recorded at extraction time (for positional EXTRACT captures against `_raw`). It falls back to context-aware matching (`"key":"value"`, `key="value"`, `key: value`, `key=value`) for EVAL-computed, aliased, JSON-flattened, and KV-mode fields. Single-character values only highlight when context-matching succeeds — a bare substring search on `"0"` would light up the whole event.

**Fields tab** lists every extracted field with phase (index-time vs search-time) and the processors that produced it. Filter pill: `All / Index-time / Search-time`.

**CIM Models tab** validates extracted fields against 16 CIM data models: Authentication, Network Traffic, Web, Endpoint, Intrusion Detection, Malware, Vulnerabilities, DLP, Email, Network Resolution (DNS), Change, Alerts, Updates, Databases, Certificates, Performance.

## Monaco editor

Custom `splunk-conf` language:

- Monarch tokenizer; `\` line continuations preserve the parent directive's context (eval, regex, alias values) via dedicated continuation states.
- Autocomplete — directive keys at line start, enum/boolean/strftime values after `=`, stanza types inside `[`.
- Hover tooltips — rich markdown: description, default, example, category, phase, value type, valid values.
- Stanza and consecutive-comment folding.
- Linting via `setModelMarkers` — unknown directives, invalid regex, type mismatches, duplicate stanzas, missing brackets, best-practice warnings.
- Light / dark themes (`splunk-light`, `splunk-dark`) tracking the app's zinc/indigo palette.

`directiveRegistry.ts` drives all three features. Add a `DirectiveInfo` entry and autocomplete, hover, and linting pick it up automatically.

## Eval expression engine

Full tokenizer and recursive-descent parser in `evalProcessor.ts`.

**Operators:** `+`, `-`, `*`, `/`, `%`, `.` (concat), `==`, `=`, `!=`, `<`, `>`, `<=`, `>=`, `AND`, `OR`, `NOT`, `IN`, `NOT IN`.

**50+ functions:**

| Category | Functions |
|---|---|
| Conditional | `if`, `case`, `coalesce`, `nullif`, `validate` |
| String | `lower`, `upper`, `len`, `substr`, `replace`, `trim`, `ltrim`, `rtrim`, `urldecode`, `split` |
| Type | `tonumber`, `tostring`, `typeof`, `isnull`, `isnotnull`, `isint`, `isnum` |
| Math | `abs`, `ceiling`/`ceil`, `floor`, `round`, `sqrt`, `pow`, `log`, `ln`, `exp`, `pi`, `min`, `max`, `random`, `sigfig`, `exact` |
| Multivalue | `mvcount`, `mvindex`, `mvfilter`, `mvappend`, `mvdedup`, `mvsort`, `mvzip`, `mvfind`, `mvjoin` |
| Crypto | `md5`, `sha1`, `sha256`, `sha512` (stub placeholders) |
| Time | `now`, `time`, `strftime`, `strptime`, `relative_time` |
| Comparison | `like`, `match`, `cidrmatch`, `searchmatch` |

All expressions are evaluated per-event before any are applied, matching Splunk's semantics.

## Tests

Tests live in `src/**/__tests__/` and run under vitest. Engine tests target the highest-risk modules — line breaking, eval, regex transforms, dest-key routing, stanza matching, indexed extractions, and a statelessness regression suite. Component smoke tests cover StatusBar, HighlightedTab, FieldsTab, and RegexTab in jsdom. Current total: 112 tests.

Engine tests default to the `node` environment; component tests opt into jsdom with `// @vitest-environment jsdom` at the top of each file so engine tests don't pay the jsdom cost.

The Azure SWA deploy workflow has a `test` job gating `build_and_deploy_job` — a failing test blocks the publish.

## Known issues / inconsistencies vs Splunk

Places where the simulator diverges from real Splunk. Verify anything suspicious against a real indexer before relying on the output.

### Not simulated

- **Lookups.** `LOOKUP-*` directives are parsed and a warning is emitted, but lookup tables are not evaluated; fields sourced from lookups will not appear.
- **Crypto functions.** `md5()`, `sha1()`, `sha256()`, `sha512()` return a placeholder string (e.g. `[md5() not simulated]`) and emit a warning.
- **Partial stubs.** `cidrmatch()`, `searchmatch()`, `relative_time()`, and `strptime()` have simplified implementations; results may not match Splunk on edge cases.
- **`SEDCMD` transliteration.** Only the `s/` substitute form is supported; the `y/abc/ABC/` transliteration form is silently ignored.

### Simplified

- **Delimited `INDEXED_EXTRACTIONS` overrides not honoured.** For `csv`/`tsv`/`psv`/`w3c`, the header is taken from line 1 and the delimiter is fixed per format. `FIELD_NAMES`, `FIELD_HEADER_REGEX`, `FIELD_QUOTE`, `KEEP_EMPTY_VALS`, and `CLEAN_KEYS` are parsed but ignored.
- **Stanza specificity is a heuristic.** Ranked by literal character count. Splunk's real tie-breaking for equal-score `source::` patterns is alphabetical; ordering can diverge for tied patterns.
- **`KV_MODE = xml`.** Uses `DOMParser` inside the Web Worker — works in Chromium, historically not in Firefox workers. A try/catch falls back silently, so XML extraction may produce no fields on unsupported browsers.
- **`PAIR_RE` in transform `FORMAT` does not handle escaped quotes in quoted values.** `"([^"]*)"` stops at the first inner `"`, so `field::"say \"hi\""` parses as `field=say \`. Real Splunk behaviour here is under-documented; treat as an edge case.

### Opt-in

- **`DEST_KEY = MetaData:*` re-routing.** By default, writing `MetaData:Sourcetype` updates the event's metadata field but search-time processors still use the original stanza match. Enable **"Re-match stanzas after metadata rewrites"** in Settings (gear icon) to run a fresh `matchStanzas` + `mergeDirectives` pass after index-time transforms, so search-time directives come from the new sourcetype. Batch mode emits a warning when any event had its routing metadata rewritten; per-event mode auto-enables manual-apply to keep the editor responsive.

### Other

- **ReDoS protection is narrow.** `safeRegex()` rejects a limited class of catastrophically backtracking patterns (nested quantifiers); it misses common forms like `(a|a)*b`, `(a+|b)+`, `(.*)*x`, and `a*a*b`. The 5 s worker watchdog backs this — patterns that slip through are killed and the worker auto-restarts.
- **Raw data capped at 1 MB.** Large inputs are rejected at the store boundary.
- **Sourcetype stanzas match by strict equality.** This matches real Splunk — sourcetype names are literal, no wildcards — noted here so contributors don't add wildcard support by analogy with `source::` / `host::`.
- **Monaco find-widget tooltip flicker.** Upstream bug in Monaco's hover service ([microsoft/monaco-editor#5208](https://github.com/microsoft/monaco-editor/issues/5208)); no local fix.

See [CHANGELOG.md](CHANGELOG.md) for fix history; see [CLAUDE.md](CLAUDE.md) (local-only, gitignored) for contributor-facing notes.

## Tech stack

React 19, Vite 7, TypeScript 5.9, Tailwind CSS 4 (CSS-first config), Monaco Editor 0.55 via `@monaco-editor/react`, Zustand 5, `react-resizable-panels` 4.6, `diff` 8, `cmdk` (command palette), `@radix-ui/react-tooltip`.

## State management

Single Zustand store (`useAppStore.ts`). The store is flat — components subscribe to individual slices rather than reading the whole store.

```
rawData / metadata / propsConf / transformsConf     User inputs (ephemeral)
processingResult / validationDiagnostics            Pipeline output
lastProcessingMs / workerStatus                     StatusBar telemetry
theme / activeOutputTab / collapsedPanels / ...     UI state
settings                                            Simulator options (e.g. perEventPipeline)
```

localStorage is limited to UI layout state (split-pane sizes, seen-intro flag, theme), read inside try/catch with typed fallbacks. Raw logs and configuration are not persisted — a refresh clears them.

Monaco editor instances live in a module-level `Map` in `editorRegistry.ts`, not in the Zustand store.

## Accessibility

- Skip-to-content link (visible on focus).
- Semantic HTML (`<main>`, `<header>`, proper heading hierarchy).
- WAI-ARIA tablist: `role="tablist"` / `role="tab"` / `role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`.
- Arrow keys navigate tabs; Home/End jump to first/last.
- All inputs have associated `<label>` via `htmlFor`/`id`.
- `focus-visible:ring-2` on all interactive elements.
- Panel-level `ErrorBoundary` with "Try Again" recovery.

## Extending

### Add a directive
1. Add a `DirectiveInfo` entry to `DIRECTIVES` in `src/monaco/directiveRegistry.ts`. Autocomplete, hover, and linting pick it up.
2. If it needs processing logic: create or edit a processor in `src/engine/processors/` and wire it into `src/engine/pipeline.ts` at the correct position, wrapped in `safeProcessor()`.

### Add a CIM model
Append to `CIM_MODELS` in `src/engine/cim/cimModelsData.ts`:

```typescript
{
  name: 'Your_Model',
  displayName: 'Your Model',
  description: 'Description',
  requiredFields: ['field1', 'field2'],
  recommendedFields: ['field3'],
  tags: ['your_tag'],
}
```

### Add an eval function
Add a `case` to the `callFunction` switch in `src/engine/processors/evalProcessor.ts`.

### Add a preview sub-tab
1. Create the component in `src/components/preview/tabs/`.
2. Add the ID to `PreviewSubTabId` in `src/engine/types.ts`.
3. Add the entry to `PREVIEW_SUB_TABS` and render it in `PreviewPanel.tsx`.
