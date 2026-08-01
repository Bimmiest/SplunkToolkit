# Splunk Toolkit

Browser-based simulator for Splunk's `props.conf` and `transforms.conf` processing pipeline. All simulation runs in the browser; no backend, no network calls, no persisted user data.

## Build

```bash
npm install
npm run dev          # Dev server on http://localhost:5173
npm run build        # tsc -b && vite build → dist/
npm run preview      # Serve production build
npm run lint         # ESLint
npm test             # vitest (one-shot)
npm run test:watch   # vitest watch mode
npm run test:e2e     # Playwright smoke tests (builds, then serves dist/)
npm run test:e2e:ui  # …in Playwright's interactive runner
```

First e2e run on a clean checkout needs the browser: `npx playwright install chromium`.

## Architecture

Input (raw log + metadata + props.conf + transforms.conf) flows through a single Zustand store. `useProcessingPipeline` debounces changes 300 ms, posts a request to a Web Worker running the full simulation, and writes the result back. A 5 s watchdog kills hung workers and replays the last in-flight request on restart. Each processor is wrapped in `safeProcessor()` — failures record a diagnostic and return the events unchanged rather than crashing the pipeline.

### Processing order

Runs in Splunk's actual order.

**Index-time**
1. Line breaking — `LINE_BREAKER`, `SHOULD_LINEMERGE`, `BREAK_ONLY_BEFORE`, `MUST_BREAK_AFTER`, `MAX_EVENTS`
2. Truncation — `TRUNCATE`
3. Timestamp extraction — `TIME_PREFIX`, `TIME_FORMAT`, `MAX_TIMESTAMP_LOOKAHEAD`, `TZ`
4. Indexed extractions — `INDEXED_EXTRACTIONS` (json, csv, tsv, psv, w3c)
5. Sed commands — `SEDCMD-<class>`
6. Transforms — `TRANSFORMS-<class>` (regex routing and `INGEST_EVAL` interleaved in `TRANSFORMS-<class>` list order; class names applied in ASCII order)

**Search-time**
7. Field extraction — `EXTRACT-<class>`
8. Report transforms — `REPORT-<class>`
9. KV mode — `KV_MODE` (auto, auto_escaped, json, xml, multi) — runs *after* `REPORT`, as Splunk documents
10. Field aliases — `FIELDALIAS-<class>`
11. Eval — `EVAL-<class>`

### Stanza precedence

`[source::<pattern>]` > `[host::<pattern>]` > `[<sourcetype>]` > `[default]`. Within a type, more specific patterns win. Directives from all matching stanzas merge in precedence order.

### Conf layers (`default/` vs `local/`) — engine API, not a UI feature

> **This one is for callers of the engine, not users of the hosted app.** The
> app's editors hold a single flat props.conf and a single flat transforms.conf,
> and there is no control that splits them into layers — so nothing described in
> this section is reachable from the browser UI. It is here because `runPipeline`
> is consumed directly (see [Using the engine directly](#using-the-engine-directly)),
> and a caller reading an app off disk needs it. Surfacing it in the UI is
> tracked in [#132](https://github.com/Bimmiest/SplunkToolkit/issues/132) and
> would arrive alongside [#86](https://github.com/Bimmiest/SplunkToolkit/issues/86).

`parseConf`, and therefore `runPipeline`, accept either the text of one flat conf or an ordered list of layers, **lowest precedence first** — which is how a caller reading an app off disk (or out of a Git worktree) hands over `$APP/default/props.conf` and `$APP/local/props.conf`:

```ts
runPipeline(raw, metadata,
  [{ layer: 'default', text: defaultProps }, { layer: 'local', text: localProps }],
  [{ layer: 'default', text: defaultTransforms }, { layer: 'local', text: localTransforms }]);
```

`layer` is a free-form label the engine only carries through as provenance (`app/local`, `system/local`, … are all fine); precedence comes from list order, since only the caller knows how its layers rank. Merging is per *attribute* within a stanza, not per file: a `local` stanza replaces only the attributes it names and the rest of the `default` stanza survives. That falls straight out of concatenating the layers in precedence order, because a repeated key in a stanza already resolves last-definition-wins.

What layered input adds to the result is provenance that parsing would otherwise destroy:

- every `ConfDirective` carries the `layer` it was read from — including the ones `mergeDirectives` returns, so "which file won this attribute" is answerable after resolution;
- the winner of a contested key carries `overrides` (nearest first, so `overrides[0]` is the value that would apply if that line were deleted) and each loser carries `overriddenBy`;
- every `ConfStanza` carries `layers` (all files defining it, lowest first) with `layer`/`lineRange` naming the highest-precedence one;
- every diagnostic derived from a directive or stanza carries `layer` alongside `line`, since both files have a line 7.

Passing a plain string produces exactly what it always did, with no provenance fields; passing one layer makes the merge a no-op. Together with stanza precedence above, these are the two halves of what `btool … --debug` prints: which stanza won, and from which file.

This is within-stanza only — a directive that wins its stanza can still lose to a higher-precedence *stanza*, which `matchStanzas`/`mergeDirectives` resolve separately.

### Layout

Header, an icon-only activity rail, the active view, and a bottom status bar. The rail switches between two top-level views:

- **Simulator** — two-panel split (inputs left, output right). The left column stacks Raw log → Metadata → props.conf → transforms.conf in a resizable group; editors collapse to fixed-height bars at the bottom so the resize handle reclaims their space.
- **Dictionary** — a browsable reference for every directive and stanza kind (see below).

Both views stay mounted and switch with `hidden` rather than rendering conditionally, so moving to the dictionary and back preserves Monaco's undo history, cursor and folding state along with the output filters. Each major panel is wrapped in an `ErrorBoundary`.

Below 768px the rail is replaced by `MobileShell`'s labelled tab strip — the rail's labels live in hover tooltips, which touch has no way to reach.

**Keyboard:** `Ctrl/Cmd+K` opens the command palette (examples, navigate, look up a directive, actions). The header info button (ⓘ) opens a slide-out reference to the 11 pipeline stages.

**Status bar:** worker status, pipeline timing, event count, distinct-field count, error/warning counts, and a "Per-event pipeline" chip when that setting is on.

## Using the engine directly

`src/engine/**` is pure logic with no React imports and no runtime dependencies, and it runs unchanged in the browser, in a Web Worker, and under Node. `runPipeline` is the entry point:

```ts
runPipeline(rawData, metadata, propsConfInput, transformsConfInput, options?)
```

`options` is `PipelineOptions`:

| Option | Default | What it does |
|---|---|---|
| `perEventPipeline` | — | Resolve stanzas per event rather than once for the batch, so metadata rewritten mid-pipeline takes effect downstream. |
| `captureOffsets` | `true` | Record capture spans for positional EXTRACTs into `fieldOffsets`. |

### Running the engine under Node

**Set `captureOffsets: false` if you are not rendering highlights.** It is not a micro-optimisation. V8 can abandon backtracking mid-match and finish on its linear-time engine:

```
node --enable-experimental-regexp-engine-on-excessive-backtracks \
     --regexp-backtracks-before-fallback=1000 your-script.mjs
```

but **that engine cannot compile a regex carrying `d`, `i` or `u`**. `captureOffsets` is what decides whether every `EXTRACT` gets `d`. Measured on `^(a|a)*(?<f>b)$` against 30 characters, with those flags set:

| | elapsed |
|---|---|
| compiled bare | 8.3 ms |
| compiled with `d` | 91,696 ms |

The flags must be set **before the first regex they protect is compiled** — in ESM, before the first import of the entry point.

**This narrows the unbounded surface; it does not remove it.** A pattern still declines the fallback if it uses a lookahead or a backreference, and both are ordinary in Splunk regexes — the `rfc5424` pattern in this repo's own sample data uses `(?=\s|$)`. The `safeRegex` ReDoS heuristic is likewise structural and documents what it cannot see, notably alternation-overlap forms like `(a|aa)+`.

**So a consumer that executes patterns it did not write needs a thread it can terminate**, with a wall-clock budget — which is what the browser app does, and what the flags are not a substitute for. Treat the flags as a second layer that lowers how often the watchdog fires.

## Project structure

```
src/
├── engine/                    # Splunk simulation (pure logic, no React)
│   ├── types.ts               # SplunkEvent, ProcessingResult, ConfDirective
│   ├── pipeline.ts            # runPipeline() — sole entry point
│   ├── pipelineWorker.ts      # Web Worker wrapper
│   ├── directiveRegistry.ts   # 78 directive entries — drives completion,
│   │                          #   hover, linting AND the dictionary
│   ├── stanzaRegistry.ts      # The four stanza header kinds + precedence
│   ├── pipelineStages.ts      # The 11 stages, and key → stage lookup
│   ├── parser/
│   │   ├── confParser.ts      # INI parser + default/local layer merge → ParsedConf
│   │   ├── provenance.ts      # Locate a diagnostic at a directive/stanza (+ its layer)
│   │   └── stanzaMatcher.ts   # Precedence-based stanza matching
│   ├── processors/            # One file per processing stage
│   ├── transforms/            # regexTransform, destKeyRouter, ingestEval
│   ├── cim/                   # cimModels.ts + cimModelsData.ts (CIM 8.5.0)
│   └── utils/
│       └── flattenJson.ts     # With prototype-pollution guard
│
├── monaco/                    # Monaco language support
│   ├── splunkConfCompletion.ts
│   ├── splunkConfHover.ts
│   ├── splunkConfFolding.ts
│   ├── splunkConfDiagnostics.ts
│   └── dictionaryCommand.ts   # "Open in dictionary" command id + URI
│
├── store/useAppStore.ts       # Zustand store (flat; subscribe per slice)
├── hooks/                     # useProcessingPipeline, useDebounce, useTheme, usePagination
├── utils/                     # splunkRegex, strftime, diffEngine, fieldHighlight
│
└── components/
    ├── layout/                # AppShell, ActivityRail, SimulatorView,
    │                          #   MobileShell, Header, StatusBar
    ├── dictionary/            # DictionaryView + list, detail, badges, entries
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

e2e/                           # Playwright smoke tests (production build, Chromium)
├── fixtures.ts                # Console/CSP error collection + readiness helpers
└── smoke.spec.ts
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

**CIM Models tab** validates extracted fields against 27 CIM datasets: Alerts, Authentication, Certificates, Change, Data Access, Databases, DLP, Email, Endpoint (Filesystem, Ports, Processes, Registry, Services), Event Signatures, Interprocess Messaging, Intrusion Detection, Inventory, JVM, Malware, Network Resolution (DNS), Network Sessions, Network Traffic, Performance, Ticket Management, Updates, Vulnerabilities, Web.

The field lists, required/recommended split and constraint tags are all derived from the model JSON that ships in Splunk's own CIM add-on (`Splunk_SA_CIM` **8.5.0**) — see the header of `src/engine/cim/cimModelsData.ts` for the exact derivation rules. Entries are one per CIM *root dataset*, so Endpoint (which has five root datasets and no model-wide `tag=endpoint`) appears five times. Three models — Databases, JVM and Interprocess Messaging — declare no key fields in the CIM, so their required score reads `n/a` rather than a meaningless 100%.

## Monaco editor

Custom `splunk-conf` language:

- Monarch tokenizer; `\` line continuations preserve the parent directive's context (eval, regex, alias values) via dedicated continuation states.
- Autocomplete — directive keys at line start, enum/boolean/strftime values after `=`, stanza types inside `[`.
- Hover tooltips — rich markdown: description, default, example, category, phase, value type, valid values.
- Stanza and consecutive-comment folding.
- Linting via `setModelMarkers` — unknown directives, invalid regex, type mismatches, duplicate stanzas, missing brackets, best-practice warnings.
- Light / dark themes (`splunk-light`, `splunk-dark`) tracking the app's zinc/indigo palette.

`directiveRegistry.ts` drives all three features. Add a `DirectiveInfo` entry and autocomplete, hover, and linting pick it up automatically — as does the dictionary.

Monaco's widgets (hover, suggest, folding, find, multi-cursor) are *contributions*, imported separately from the API surface in `MonacoEditor.tsx` via `editor.all`. `editor.api` alone registers providers that nothing ever renders. `vite.config.ts` names both entries in `manualChunks`.

## Dictionary

A reference view for every `props.conf` and `transforms.conf` setting the simulator knows about, plus the four stanza header kinds. Search by key or description, filter by phase (index-time / search-time) and conf file, hide deprecated keys, and read each entry's description, example, default, valid values and pipeline stage.

Every row in the browse list carries two designations — which conf file it belongs in, and which phase it runs at — so both are answerable without opening the entry. That is also what distinguishes `MATCH_LIMIT` and `DEPTH_LIMIT`, the two keys the registry defines once per conf file with file-specific wording.

There is no prose here that the editor does not also have: entries are built from `directiveRegistry.ts` and `stanzaRegistry.ts`, so the dictionary and the hover tooltips cannot drift apart. The pipeline reference drawer and the dictionary answer different questions — "what runs when" versus "what does this key do" — and cross-link both ways.

Three routes in: the activity rail, `Ctrl/Cmd+K` → "Dictionary: KEY", and the "Open in dictionary" link at the bottom of any directive hover.

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

Tests live in `src/**/__tests__/` and run under vitest. Engine tests target the highest-risk modules — line breaking, eval, regex transforms, dest-key routing, stanza matching, indexed extractions, and a statelessness regression suite. Component smoke tests cover StatusBar, HighlightedTab, FieldsTab, and RegexTab in jsdom. (`npm test` prints the current total; a number written here has gone stale three times.)

Engine tests default to the `node` environment; component tests opt into jsdom with `// @vitest-environment jsdom` at the top of each file so engine tests don't pay the jsdom cost.

### End-to-end (`npm run test:e2e`)

A small Playwright suite in `e2e/` runs Chromium against a **production build** — `playwright.config.ts` rebuilds before serving, because a stale `dist/` produces confident wrong answers. `npm run test:e2e:ui` opens the interactive runner.

It exists for the things vitest structurally cannot reach, each of which has failed silently here before:

- **The Content-Security-Policy.** It lives in `index.html` and only means anything in a browser. `img-src` was missing for the entire life of the policy, so Chromium refused every one of Monaco's `data:` squiggle SVGs and the lint underlines never drew — visible only as a console error nobody was watching. The suite asserts zero CSP violations and zero console errors on boot.
- **Worker bundling.** The whole simulation runs in a Web Worker created via `new Worker(new URL(…), { type: 'module' })`. Whether Vite emits a loadable chunk for that is a build-time question with a runtime answer.
- **The Monaco chunk split.** `MonacoEditor.tsx` imports the slim `editor.api` entry and `vite.config.ts` hand-rolls `manualChunks` around it. A bad split type-checks, builds, and then fails to mount an editor.

One note if you extend it: the app runs the pipeline once on mount with an empty raw log, and `runPipeline` returns a real result for empty input (`eventCount: 0`). So the status bar reads "Worker idle · 0 events" *before* anything is loaded — wait on a non-zero event count, as `loadExample` does, not on the idle state.

`@playwright/test` is pinned to `~1.56` to match the Chromium revision preinstalled in the dev container; bump it freely, since CI installs the matching browser itself.

`ci.yml` runs lint → build (`tsc -b && vite build`) → tests → e2e smoke → `npm audit` on every PR and on pushes to main. The Azure SWA deploy workflow is separate and has no test job of its own: it triggers on push to main and runs its own build, so it is gated by CI only in the sense that both run on the same commit. Node is pinned once, in `.nvmrc`, which `ci.yml` and `package.json`'s `engines` both follow.

## Known issues / inconsistencies vs Splunk

Places where the simulator diverges from real Splunk. Verify anything suspicious against a real indexer before relying on the output.

### Not simulated

- **Lookups.** `LOOKUP-*` directives are parsed and a warning is emitted, but lookup tables are not evaluated; fields sourced from lookups will not appear.
- **Crypto functions.** `md5()`, `sha1()`, `sha256()`, `sha512()` return a placeholder string (e.g. `[md5() not simulated]`) and emit a warning.
- **Partial stubs.** `cidrmatch()`, `searchmatch()`, `relative_time()`, `strptime()`, `mvfilter()` (returns its input unfiltered), and `sigfig()` / `exact()` (return the value unrounded) have simplified implementations; results may not match Splunk on edge cases. Every one of them emits a warning when evaluated, so a stubbed result is never mistaken for a computed one.
- **`SEDCMD` transliteration.** Only the `s/` substitute form is simulated. The `y/abc/ABC/` transliteration form, the numeric occurrence flag (`s/…/…/2`), a value that is not a sed expression at all, and a pattern that will not compile each emit a warning rather than being dropped in silence.

### Simplified

- **Delimited `INDEXED_EXTRACTIONS` overrides not honoured.** For `csv`/`tsv`/`psv`/`w3c`, the header is taken from line 1 and the delimiter is fixed per format. `FIELD_NAMES`, `FIELD_HEADER_REGEX`, `FIELD_QUOTE`, `KEEP_EMPTY_VALS`, and `CLEAN_KEYS` are parsed but ignored.
- **Stanza specificity is a heuristic.** Ranked by literal character count. Splunk's real tie-breaking for equal-score `source::` patterns is alphabetical; ordering can diverge for tied patterns.
- **`KV_MODE = xml`.** Uses `DOMParser` inside the Web Worker — works in Chromium, historically not in Firefox workers. A try/catch falls back silently, so XML extraction may produce no fields on unsupported browsers.
- **`PAIR_RE` in transform `FORMAT` does not handle escaped quotes in quoted values.** `"([^"]*)"` stops at the first inner `"`, so `field::"say \"hi\""` parses as `field=say \`. Real Splunk behaviour here is under-documented; treat as an edge case.

### Opt-in

- **`DEST_KEY = MetaData:*` re-routing.** By default, writing `MetaData:Sourcetype` updates the event's metadata field but search-time processors still use the original stanza match. Enable **"Re-match stanzas after metadata rewrites"** in Settings (gear icon) to run a fresh `matchStanzas` + `mergeDirectives` pass after index-time transforms, so search-time directives come from the new sourcetype. Batch mode emits a warning when any event had its routing metadata rewritten; per-event mode auto-enables manual-apply to keep the editor responsive.

### Other

- **ReDoS protection is heuristic first, worker-backed second.** `safeRegex()` rejects a best-effort class of catastrophically backtracking patterns before compiling them — nested/grouped quantifiers (`(a+)+`, `(.*)*x`, `(.*,){20}`) and adjacent same-atom quantifiers (`a*a*`, `\d+\d+`) — but it does **not** catch alternation-overlap forms like `(a|aa)+` or `(a+|b)+` (detecting those without rejecting benign alternations such as `(foo|bar)+` needs a real overlap analysis). Both the main processing pipeline (5 s watchdog) and the **Regex tab's live tester** (its own 2 s watchdog) run matching inside a Web Worker, so a pattern that slips the heuristic hangs the worker — which is terminated and restarted — rather than freezing the UI. The one remaining main-thread matcher is the **Create-EXTRACT dialog's** live capture (a single event's text), still guarded only by the heuristic.
- **Raw data capped at 1 MB.** The cap is applied inside the pipeline, not at the store: a larger input is accepted, stored and sent to the worker in full, then *truncated* for processing — cut back to the last complete line, so the trailing partial event is dropped rather than mis-broken, with a warning saying so. Nothing rejects the input, and the editor still holds all of it.
- **Sourcetype stanzas match by strict equality.** This matches real Splunk — sourcetype names are literal, no wildcards — noted here so contributors don't add wildcard support by analogy with `source::` / `host::`.
- **Monaco find-widget tooltip flicker.** Upstream bug in Monaco's hover service ([microsoft/monaco-editor#5208](https://github.com/microsoft/monaco-editor/issues/5208)); no local fix.

See [CHANGELOG.md](CHANGELOG.md) for fix history

## Tech stack

- React 19, 
- Vite 7, 
- TypeScript 5.9, 
- Tailwind CSS 4 (CSS-first config), 
- Monaco Editor 0.55, mounted directly by `MonacoEditor.tsx`, 
- Zustand 5, 
- react-resizable-panels 4.6, 
- `diff` 8, 
- `cmdk` (command palette), 
- `@radix-ui/react-tooltip`.

## State management

Single Zustand store (`useAppStore.ts`). The store is flat — components subscribe to individual slices rather than reading the whole store.

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

## Extending

### Add a directive
1. Add a `DirectiveInfo` entry to `DIRECTIVES` in `src/monaco/directiveRegistry.ts`. Autocomplete, hover, and linting pick it up.
2. If it needs processing logic: create or edit a processor in `src/engine/processors/` and wire it into `src/engine/pipeline.ts` at the correct position, wrapped in `safeProcessor()`.

### Add or update a CIM model
`CIM_MODELS` in `src/engine/cim/cimModelsData.ts` is generated, not hand-maintained.
To refresh it, download the CIM add-on from
[Splunkbase](https://splunkbase.splunk.com/app/1621), extract it, and run:

```bash
node scripts/generate-cim-models.js /path/to/Splunk_SA_CIM
```

The script reads `default/data/models/*.json` (the model definitions Splunk itself
runs) and takes `CIM_VERSION` from the add-on's `app.conf`. Which datasets are
presented, and their labels, live in the `INCLUDE` table at the top of the script;
everything else — fields, the required/recommended split, constraint tags — is read
out of the add-on, and a dataset that Splunk has renamed or removed fails the run
rather than disappearing quietly. Nothing here runs at build or install time, and
the add-on is not vendored.

To add a dataset by hand instead, read the derivation rules in the generated file's
header first — the fields must come from the model JSON, not from memory or docs prose:

```typescript
{
  name: 'Your_Model',          // or 'Your_Model.Dataset' for a second root dataset
  displayName: 'Your Model',
  description: 'Description',
  requiredFields: ['field1', 'field2'],
  recommendedFields: ['field3'],
  tags: ['your_tag'],          // ALL tags must be present for the dataset to populate
}
```

### Add an eval function
Add a `case` to the `callFunction` switch in `src/engine/processors/evalProcessor.ts`.

### Add a preview sub-tab
1. Create the component in `src/components/preview/tabs/`.
2. Add the ID to `PreviewSubTabId` in `src/engine/types.ts`.
3. Add the entry to `PREVIEW_SUB_TABS` and render it in `PreviewPanel.tsx`.
