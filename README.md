# Splunk Toolkit

A browser-based simulator for Splunk's `props.conf` and `transforms.conf` processing pipeline. Paste raw log data, write configuration, and instantly see how Splunk would process it — event breaking, timestamp extraction, field extraction, transforms, CIM validation, and more.

**Zero backend. Zero data persistence. Everything runs in your browser.**

---

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Paste raw logs, configure `props.conf`, and watch the Preview panel update in real-time.

```bash
npm run build      # Production build -> dist/
npm run preview    # Preview the production build locally
```

---

## Architecture

### Data Flow

```
User Input (Raw Data + Metadata + props.conf + transforms.conf)
    |
    v
Zustand Store --(300ms debounce)--> Processing Pipeline
    |                                       |
    v                                       v
UI Components                    ProcessingResult + Diagnostics
    <---------------------------------------'
```

All state flows through a single Zustand store. The `useProcessingPipeline` hook watches for input changes, debounces them, runs the full Splunk simulation pipeline, and writes results back to the store. UI components subscribe to the slices they need.

### Layout

```
+----------------------------------------------------------+
| Header                                    [Theme Toggle]  |
+---------------------------+------------------------------+
| Raw Log (textarea)        | Output                       |
|                           |   [Preview|CIM|Fields|       |
| Metadata (collapsible)    |    Transforms|Architecture]  |
|   index/host/source/st    |                              |
+---------------------------+   Preview sub-tabs:          |
| props.conf (collapsible)  |   Raw | Timestamp |          |
|   (Monaco editor)         |   Highlighted |              |
+---------------------------+   Calculated Fields | Diff   |
| transforms.conf           |                              |
|   (collapsible, Monaco)   |                              |
+---------------------------+------------------------------+
```

The left column uses a vertical resizable panel group. The `props.conf` and `transforms.conf` editors are collapsible — when collapsed, they nest as fixed-height bars at the bottom of the left column (outside the resizable group), allowing the resize handle to reclaim their space. The Metadata section within the Raw panel is also collapsible.

All panels are resizable via `react-resizable-panels`. Each major panel is wrapped in an `ErrorBoundary` for fault isolation.

---

## Project Structure

```
src/
├── main.tsx                          # Entry point
├── App.tsx                           # Root component, theme init, skip-nav
├── index.css                         # Tailwind v4, CSS custom properties
│
├── engine/                           # Splunk simulation engine (pure logic, no React)
│   ├── types.ts                      # Core types: SplunkEvent, ProcessingResult, etc.
│   ├── pipeline.ts                   # Orchestrates the full processing pipeline
│   ├── parser/
│   │   ├── confParser.ts             # Parses .conf INI syntax -> ParsedConf AST
│   │   └── stanzaMatcher.ts          # Matches events to stanzas by precedence
│   ├── processors/                   # One file per processing stage
│   │   ├── lineBreaker.ts            # LINE_BREAKER + SHOULD_LINEMERGE
│   │   ├── timestampExtractor.ts     # TIME_PREFIX + TIME_FORMAT
│   │   ├── truncator.ts              # TRUNCATE
│   │   ├── indexedExtractions.ts     # INDEXED_EXTRACTIONS (JSON/CSV/TSV)
│   │   ├── sedCmd.ts                 # SEDCMD-<class>
│   │   ├── transformsProcessor.ts    # TRANSFORMS-<class> / REPORT-<class>
│   │   ├── fieldExtractor.ts         # EXTRACT-<class>
│   │   ├── kvMode.ts                 # KV_MODE (auto/json/xml/none)
│   │   ├── fieldAlias.ts             # FIELDALIAS-<class>
│   │   └── evalProcessor.ts          # EVAL-<class> (50+ functions, recursive descent)
│   ├── transforms/
│   │   ├── regexTransform.ts         # REGEX + FORMAT field extraction
│   │   ├── destKeyRouter.ts          # DEST_KEY routing (_raw, _meta, queue)
│   │   └── ingestEval.ts             # INGEST_EVAL
│   ├── cim/
│   │   ├── cimModels.ts              # CIM validator logic
│   │   └── cimModelsData.ts          # 16 CIM data model definitions
│   └── utils/
│       └── flattenJson.ts            # Recursive JSON flattening for field extraction
│
├── monaco/                           # Monaco Editor language support
│   ├── directiveRegistry.ts          # 45+ directive metadata entries
│   ├── splunkConfCompletion.ts       # CompletionItemProvider
│   ├── splunkConfHover.ts            # HoverProvider (rich markdown tooltips)
│   ├── splunkConfFolding.ts          # FoldingRangeProvider (stanza + comment folding)
│   └── splunkConfDiagnostics.ts      # Diagnostics (linting via setModelMarkers)
│
├── store/
│   └── useAppStore.ts                # Zustand store (all application state)
│
├── hooks/
│   ├── useProcessingPipeline.ts      # Debounced pipeline orchestration
│   ├── useDebounce.ts                # Generic debounce hook
│   ├── useTheme.ts                   # Light/dark theme management
│   └── usePagination.ts              # Event pagination logic
│
├── utils/
│   ├── splunkRegex.ts                # Safe regex construction, pattern conversion
│   ├── strftime.ts                   # Splunk strftime <-> JS date parsing
│   ├── diffEngine.ts                 # Character-level diff computation
│   └── fieldHighlight.ts             # Context-aware field value position matching
│
└── components/
    ├── layout/
    │   ├── AppShell.tsx              # Main layout (react-resizable-panels)
    │   └── Header.tsx                # Top bar with title + theme toggle
    ├── raw/
    │   └── RawPanel.tsx              # Raw log textarea + character count
    ├── metadata/
    │   └── MetadataPanel.tsx         # Collapsible index/host/source/sourcetype inputs
    ├── editor/
    │   ├── SplunkEditor.tsx          # Monaco wrapper with Monarch tokenizer
    │   ├── PropsConfEditor.tsx       # props.conf editor (collapsible)
    │   ├── TransformsConfEditor.tsx   # transforms.conf editor (collapsible)
    │   ├── EditorValidationList.tsx   # Inline validation summary per editor
    │   └── CopyButton.tsx            # Copy-to-clipboard button
    ├── preview/
    │   ├── PreviewPanel.tsx          # Output tab container + preview sub-tabs
    │   ├── PreviewFilterBar.tsx      # Search, field, status, and modification filters
    │   ├── EventCard.tsx             # Single event display card
    │   ├── EventPagination.tsx       # Page controls
    │   └── tabs/
    │       ├── RawTab.tsx            # Events with line numbers + timestamps
    │       ├── TimestampTab.tsx      # Timestamp extraction details per event
    │       ├── HighlightedTab.tsx    # Color-coded field extractions with sidebar
    │       ├── CalculatedFieldsTab.tsx # EVAL-computed field highlighting
    │       ├── DiffTab.tsx           # Git-style before/after diff
    │       ├── CimModelsTab.tsx      # CIM compliance with progress bars
    │       ├── FieldsTab.tsx         # All extracted fields table
    │       └── TransformsTab.tsx     # Processing pipeline summary
    ├── architecture/
    │   └── ArchitecturePanel.tsx     # SVG deployment architecture diagram
    └── ui/
        ├── Tabs.tsx                  # Accessible tablist with keyboard nav
        ├── Badge.tsx                 # Colored status badges
        ├── ProgressBar.tsx           # Animated progress bars
        ├── MultiSelect.tsx           # Multi-select dropdown for filters
        ├── CollapsiblePanel.tsx      # Expand/collapse sections
        ├── ThemeToggle.tsx           # Light/dark mode switch
        └── ErrorBoundary.tsx         # Fault-isolating error boundary
```

---

## Processing Engine

The engine simulates Splunk's actual processing pipeline, executing in the exact same order Splunk does.

### Processing Order

| Step | Processor | Phase | Directives |
|------|-----------|-------|-----------|
| 1 | Line Breaking | Index-time | `LINE_BREAKER`, `SHOULD_LINEMERGE`, `BREAK_ONLY_BEFORE`, `BREAK_ONLY_BEFORE_DATE`, `MUST_BREAK_AFTER` |
| 2 | Truncation | Index-time | `TRUNCATE` |
| 3 | Timestamp | Index-time | `TIME_PREFIX`, `TIME_FORMAT`, `MAX_TIMESTAMP_LOOKAHEAD`, `TZ` |
| 4 | Indexed Extractions | Index-time | `INDEXED_EXTRACTIONS` (json, csv, tsv) |
| 5 | Sed Commands | Index-time | `SEDCMD-<class>` |
| 6 | Transforms | Index-time | `TRANSFORMS-<class>` via transforms.conf stanzas |
| 7 | Ingest Eval | Index-time | `INGEST_EVAL` (from transforms.conf) |
| 8 | Field Extraction | Search-time | `EXTRACT-<class>` |
| 9 | KV Mode | Search-time | `KV_MODE` (auto, json, xml, none) |
| 10 | Report Transforms | Search-time | `REPORT-<class>` via transforms.conf stanzas |
| 11 | Field Aliases | Search-time | `FIELDALIAS-<class>` |
| 12 | Eval | Search-time | `EVAL-<class>` |

### Stanza Precedence

Matches Splunk's priority order (highest to lowest):

```
[source::<pattern>]  >  [host::<pattern>]  >  [<sourcetype>]  >  [default]
```

The `stanzaMatcher.ts` module handles wildcard pattern matching for source and host stanzas, and merges directives from all matching stanzas in precedence order (first match wins).

### Eval Expression Engine

The `evalProcessor.ts` contains a full tokenizer and recursive-descent parser supporting:

**Operators**: `+`, `-`, `*`, `/`, `%`, `.` (string concat), `==`, `!=`, `<`, `>`, `<=`, `>=`, `AND`, `OR`, `NOT`

**50+ functions**:

| Category | Functions |
|----------|-----------|
| Conditional | `if`, `case`, `coalesce`, `nullif`, `validate` |
| String | `lower`, `upper`, `len`, `substr`, `replace`, `trim`, `ltrim`, `rtrim`, `urldecode`, `split` |
| Type | `tonumber`, `tostring`, `typeof`, `isnull`, `isnotnull`, `isint`, `isnum` |
| Math | `abs`, `ceiling`/`ceil`, `floor`, `round`, `sqrt`, `pow`, `log`, `ln`, `exp`, `pi`, `min`, `max`, `random`, `sigfig`, `exact` |
| Multivalue | `mvcount`, `mvindex`, `mvfilter`, `mvappend`, `mvdedup`, `mvsort`, `mvzip`, `mvfind`, `mvjoin` |
| Crypto | `md5`, `sha1`, `sha256`, `sha512` (stub placeholders) |
| Time | `now`, `time`, `strftime`, `strptime`, `relative_time` |
| Comparison | `like`, `match`, `cidrmatch`, `searchmatch` |
| Other | `null` |

Eval expressions are evaluated in parallel per-event: all expressions are computed before any are applied, matching Splunk's behavior.

### Resilience

Each processor step is wrapped in `safeProcessor()`. If any individual step throws an exception, the pipeline continues with the events from the previous step and reports the error as a diagnostic. The pipeline never crashes entirely from a single processor failure.

Raw data input is capped at 1MB to prevent browser tab freezes.

---

## Monaco Editor

The editors use a custom `splunk-conf` language registered with Monaco, providing IDE-grade editing for Splunk configuration files.

The Monarch tokenizer supports `\` line continuations — continuation lines preserve the highlighting context of the parent directive (eval expressions, regex patterns, field alias values, etc.) via dedicated continuation states.

### Features

| Feature | Implementation |
|---------|---------------|
| **Syntax highlighting** | Monarch tokenizer — stanza headers, directives, regex patterns, strftime tokens, eval expressions, comments, class-based directives (`EXTRACT-myclass`), `\` line continuations |
| **Autocomplete** | `CompletionItemProvider` — context-aware: directive keys at line start, enum/boolean/strftime values after `=`, stanza types inside `[` |
| **Hover tooltips** | `HoverProvider` — rich markdown with description, default value, example, category, processing phase, value type, and valid values |
| **Stanza folding** | `FoldingRangeProvider` — fold stanza blocks and consecutive comment blocks |
| **Linting** | `setModelMarkers` — unknown directives, invalid regex, type mismatches (boolean/number/enum), duplicate stanzas, missing brackets, best-practice warnings |
| **Light/dark themes** | Two custom themes (`splunk-light`, `splunk-dark`) that sync with the application theme |

### Directive Registry

`directiveRegistry.ts` contains metadata for 45+ directives:

```typescript
interface DirectiveInfo {
  key: string;
  description: string;
  example: string;
  defaultValue: string;
  category: string;            // "Time Configuration", "Event Breaking", etc.
  appliesTo: 'props.conf' | 'transforms.conf' | 'both';
  valueType: 'regex' | 'string' | 'number' | 'boolean' | 'enum' | 'strftime' | 'eval';
  enumValues?: string[];
  isClassBased: boolean;
  phase: 'index-time' | 'search-time' | 'both';
  deprecated?: boolean;
}
```

This single registry powers autocomplete, hover tooltips, and linting. Add a directive entry here and all three features pick it up automatically.

---

## Output Tabs

The Output panel has five top-level tabs. The **Preview** tab contains six sub-tabs that share a common filter bar (search, field, status, and modification filters) and pagination controls.

### Top-Level Tabs

| Tab | Description |
|-----|-------------|
| **Preview** | Event display with sub-tabs (see below), shared filters, and pagination |
| **CIM Models** | Validates extracted fields against 16 CIM data models with progress bars per model and field-by-field breakdown |
| **Fields** | Searchable/sortable table of all extracted fields — name, value, extraction type, source directive, event count |
| **Pipeline** | Full processing pipeline summary — all transforms in execution order with REGEX/FORMAT/DEST_KEY |
| **Architecture** | SVG deployment architecture diagram |

### Preview Sub-Tabs

| Sub-Tab | Description |
|---------|-------------|
| **Raw** | Events after line/event breaking, with line numbers, timestamp regions, and field badges |
| **Timestamp** | Timestamp extraction details — matched prefix, format pattern, and parsed timestamp per event |
| **Extractions** | Field extractions color-coded inline within `_raw`, with a collapsible field sidebar supporting search, pin-to-filter, and hierarchical field grouping |
| **Calculated Fields** | EVAL-computed fields highlighted inline within `_raw`, showing which calculated values appear in the original text |
| **Diff** | Character-level unified diff (red/green) comparing original raw data vs processed `_raw` |
| **Regex** | Interactive regex reference panel — test patterns against event text and browse common Splunk regex constructs |

Field highlighting uses context-aware matching — values are matched next to their field key names (JSON `"key":"value"`, KV `key=value`) rather than by plain substring search, ensuring fields like `accountId` and `recipientAccountId` highlight correctly even when they share the same value.

All sub-tabs support paginated event display (configurable: 5/10/25/50 events per page).

---

## CIM Validation

16 Common Information Model data models are included:

- Authentication
- Network Traffic
- Web
- Endpoint
- Intrusion Detection
- Malware
- Vulnerabilities
- DLP
- Email
- Network Resolution (DNS)
- Change
- Alerts
- Updates
- Databases
- Certificates
- Performance

Each model defines required and recommended fields. The validator checks your extracted fields against these models and reports a compliance percentage.

---

## State Management

Single Zustand store (`useAppStore.ts`) with minimal persistence. Layout preferences are saved to localStorage; all user data (raw logs, configuration) is ephemeral — refresh clears it.

```
rawData / metadata / propsConf / transformsConf   <-- User inputs
processingResult / validationDiagnostics           <-- Pipeline outputs
theme / activeOutputTab / collapsedPanels / etc.   <-- UI state
```

---

## Tech Stack

| Dependency | Version | Purpose |
|-----------|---------|---------|
| React | 19 | UI framework |
| Vite | 7 | Build tool + dev server |
| TypeScript | 5.9 | Type safety |
| Tailwind CSS | 4 | Styling (v4 CSS-first config, no PostCSS) |
| Monaco Editor | 0.55 | Code editors (`@monaco-editor/react` wrapper) |
| Zustand | 5 | State management |
| react-resizable-panels | 4.6 | Resizable panel layout |
| diff | 8 | Diff computation for the Diff tab |

---

## Security

- **Minimal persistence**: The Extractions panel split-ratio is persisted to `localStorage`; all other state (raw logs, configuration) is ephemeral — refresh clears it.
- **No network requests**: All processing is client-side. Zero API calls.
- **CSP headers**: `index.html` sets `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'; worker-src 'self' blob:; font-src 'self' data:`. `unsafe-eval` is required by the Monaco Editor web worker; `unsafe-inline` is required for Tailwind's runtime style injection.
- **Input sanitization**: React's JSX escaping prevents XSS. All regex construction goes through `safeRegex()` which rejects invalid patterns and patterns with known ReDoS risk before compilation.
- **Input limits**: Raw data capped at 1MB. Individual processor failures are caught and reported without crashing the pipeline.

---

## Accessibility

- **Skip-to-content link**: Visible on keyboard focus, jumps past the header
- **Semantic HTML**: `<main>`, `<header>`, proper heading hierarchy
- **ARIA tabs**: Full WAI-ARIA tablist pattern — `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`
- **Keyboard navigation**: Arrow keys navigate between tabs, Home/End jump to first/last
- **Form labels**: All inputs have associated `<label>` elements via `htmlFor`/`id`
- **Focus indicators**: `focus-visible:ring-2` on all interactive elements
- **Error boundaries**: Panel-level fault isolation with "Try Again" recovery button

---

## Extending the Toolkit

### Adding a New Directive

1. Add a `DirectiveInfo` entry to the `DIRECTIVES` array in `src/monaco/directiveRegistry.ts`.
2. That's it — autocomplete, hover tooltips, and linting all pick it up automatically.

If the directive requires processing logic:

3. Create or edit a processor in `src/engine/processors/`.
4. Wire it into `src/engine/pipeline.ts` at the correct position in the processing order, wrapped in `safeProcessor()`.

### Adding a New CIM Model

Add an entry to the `CIM_MODELS` array in `src/engine/cim/cimModelsData.ts`:

```typescript
{
  name: 'Your_Model',
  displayName: 'Your Model',
  description: 'Description of what this model covers',
  requiredFields: ['field1', 'field2'],
  recommendedFields: ['field3', 'field4'],
  tags: ['your_tag'],
}
```

The CIM Models tab will include it automatically.

### Adding a New Eval Function

Add a `case` branch to the `callFunction` switch in `src/engine/processors/evalProcessor.ts`:

```typescript
case 'myfunc': return /* your implementation */;
```

### Adding a New Preview Sub-Tab

1. Create a tab component in `src/components/preview/tabs/`.
2. Add the tab ID to the `PreviewSubTabId` union type in `src/engine/types.ts`.
3. Add the tab entry to `PREVIEW_SUB_TABS` in `src/components/preview/PreviewPanel.tsx`.
4. Render the component in the `PreviewSubTab` function in the same file.

### Adding a New Output Tab

1. Add the tab ID to the `OutputTabId` union type in `src/engine/types.ts`.
2. Add the tab entry to the `tabs` array in `PreviewPanel`.
3. Add the `case` to the `TabContent` switch in the same file.

---

## Development

```bash
npm run dev          # Start dev server with HMR (http://localhost:5173)
npm run build        # Type-check (tsc) + production build (vite)
npm run lint         # ESLint
npm run preview      # Serve production build locally
```
