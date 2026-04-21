# Changelog

All notable changes to Splunk Toolkit are documented here, newest first.

---

## 2026-04-21

### Added

- **React component smoke tests** — `@testing-library/react` + `jsdom` harness added. 20 new tests across `StatusBar` (7), `RegexTab` (4), `FieldsTab` (4), `HighlightedTab` (5). Component tests opt into jsdom via `// @vitest-environment jsdom` pragma; engine tests remain in the `node` environment. `ResizeObserver` polyfilled in `src/test/setup.ts`. Total: 112 tests (up from 92).
- **`SplunkEvent.fieldOffsets`** ([types.ts](src/engine/types.ts)) — optional `Record<string, Array<[number, number]>>` recording authoritative `[start, end]` byte ranges in `_raw` per field, populated by `fieldExtractor` using the `'gd'` regex flag.
- **`fieldExtractor` offset recording** ([fieldExtractor.ts](src/engine/processors/fieldExtractor.ts)) — offsets recorded only when EXTRACT targets `_raw`; multivalue captures produce one offset per occurrence in document order.

### Fixed

- **Extractions tab: regex-extracted field value highlighted at wrong occurrence** — `HighlightedRaw` now uses authoritative `fieldOffsets` for positional captures; falls back to context matching only for EVAL-computed, aliased, and KV-mode-extracted fields. The substring-equality guard protects against later processors mutating `_raw` or field values after EXTRACT runs.
- **Hard-coded hex colours across 9 components** — `--color-text-on-accent` CSS token added; all `'#fff'` on accent backgrounds and status-color literals (`#22c55e`, `#4ade80`, `#f87171`, `#fb923c`) replaced with `var(--color-*)` refs.
- **Stale fieldHighlight test** — "fallback indexOf" test updated to expect 1 occurrence (first hit only).

### Changed

- **`FIELD_COLORS` palette hoisted** into [shared/fieldColors.ts](src/components/preview/tabs/shared/fieldColors.ts); duplicate definitions removed from `useFieldFocus.ts` and `RegexTab.tsx`.
- **Monaco editor instances moved out of Zustand** — new [editorRegistry.ts](src/components/editor/editorRegistry.ts) module-level `Map` with `registerEditor` / `getEditor`. `editorInstances` and `registerEditor` removed from `useAppStore.ts`.
- **`window.monaco` type declared** in [src/global.d.ts](src/global.d.ts); unsafe `window as unknown as { monaco?: ... }` casts removed from `SplunkEditor.tsx`.
- **`buildContextPatterns` memoised** in `fieldHighlight.ts` — module-level `_patternCache: Map<string, RegExp[]>` keyed on `key\x1fvalue` eliminates repeated `new RegExp()` allocations.
- **CIM compliance check** collapsed from two `filter()` passes to a single `for` loop per field list ([cimModels.ts](src/engine/cim/cimModels.ts)).
- **`eventBadgeCounts` wrapped in `useMemo`** in `HighlightedTab` — hover/pin state changes no longer trigger badge recomputation.
- **`normalise` hoisted** to module scope in `PreviewPanel.tsx`.

---

## 2026-04-20

### Added

- **CI test gate** — `test` job added to Azure SWA workflow (npm ci → lint → tsc --noEmit → npm test); `build_and_deploy_job` now has `needs: test`. A failing test blocks the SWA publish.
- **"Per-event pipeline" chip in StatusBar** — accent-coloured pill visible when `settings.perEventPipeline` is true; click opens Settings panel.
- **Fields tab: Phase column + filter** ([FieldsTab.tsx](src/components/preview/tabs/FieldsTab.tsx)) — Source column replaced with Phase column derived from `processingTrace[*].phase`. Accent badge for index-time, muted for search-time; processor names in `title` tooltip. `All / Index-time / Search-time` pill filter added to toolbar.

### Fixed

- **`MAX_TIMESTAMP_LOOKAHEAD` default corrected** from `128` to `150` to match Splunk's documented default. Monaco `directiveRegistry.ts` `defaultValue` and `example` updated to match.
- **Regex tab reverted to matched-events-only** — no pattern → empty-state prompt; valid pattern → only matching events shown; no match → explicit "no matches" message.
- **Long diagnostic messages no longer clip** ([EditorValidationList.tsx](src/components/editor/EditorValidationList.tsx)) — `truncate` removed from `DiagnosticRow`; `white-space: normal; overflow-wrap: anywhere` added to message span and suggestion div.
- **Extractions-tab double-highlight narrowed** — fallback `indexOf` loop replaced with single first-hit lookup, preventing the same value from being highlighted at multiple positions when context patterns miss.

### Changed

- **Fields sidebar** — processor-name hover span removed from leaf nodes in `FieldTreeNode.tsx`; auto/manual/calc badges in Fields tab are the single source of truth.
- **Known limitations** — delimited `INDEXED_EXTRACTIONS` override directives (`FIELD_NAMES`, `FIELD_HEADER_REGEX`, `FIELD_QUOTE`, `KEEP_EMPTY_VALS`, `CLEAN_KEYS`) documented as not honoured.

---

## 2026-04-19

### Added

- **StatusBar** ([src/components/layout/StatusBar.tsx](src/components/layout/StatusBar.tsx)) — 24px bottom bar showing worker status (coloured dot), pipeline timing (ms/s), event count, distinct field count, and error/warning/valid indicators. Telemetry items removed from Header.
- **Command palette** (Ctrl/Cmd+K) — `cmdk`-based overlay with Examples, Navigate, and Actions groups. State in `commandPaletteOpen` / `toggleCommandPalette` on the store.
- **Raw Log editor upgraded to Monaco** — `plaintext` mode with word-wrap; autocomplete, suggestions, and folding disabled for paste-and-inspect use.
- **Pipeline reference panel** — Header ⓘ button toggles a slide-out listing all 11 pipeline stages with descriptions and directive chips.
- **First-run banner** ([FirstRunBanner.tsx](src/components/onboarding/FirstRunBanner.tsx)) — 3-step workflow strip (Paste → Write config → Inspect); dismissed to `localStorage` with try/catch.
- **Collapsible metadata strip** in Raw tab event cards — `index/host/source/sourcetype` bar is a disclosure row (defaults to closed); "Metadata modified" badge stays visible.
- **Sub-tab pill variant** — `Tabs` component gains `variant="secondary"` (rounded pills, `--color-bg-elevated` + border + shadow-sm when active). `PreviewPanel` passes `variant="secondary"` to sub-tabs.
- **Event card expand/collapse** in Raw tab — 300px `max-height` clip with overflow-detected "Show full event / Show less" toggle.
- **Truncator processing trace annotation** — trace description ends with `(TRUNCATE default)` or `(TRUNCATE=N)`; Raw tab renders a warning-coloured `Truncated` badge.
- **`fieldSourceKeys`** added to `SplunkEvent` ([types.ts](src/engine/types.ts)) — `Record<string, string>` mapping stripped field name to original JSON key; populated by `INDEXED_EXTRACTIONS=json`.

### Fixed

- **Extractions-tab highlight collision for underscore-stripped JSON fields** — `flattenJson` records `strippedName → originalKey` in a `sourceKeys` output map; `findFieldValuePositions` tries the original key first so sibling fields with the same value no longer steal each other's highlight position. Single-character field values now highlight when context matching succeeds (the `v.length < 2` guard moved into the fallback `indexOf` path only).
- **Index-time leading-underscore stripping** ([indexedExtractions.ts](src/engine/processors/indexedExtractions.ts)) — JSON, CSV/TSV/PSV/W3C headers, `INGEST_EVAL` LHS assignments, and `WRITE_META` destination keys now strip leading underscores to match real Splunk behaviour. (Closes [issue #1](https://github.com/Bimmiest/SplunkToolkit/issues/1), commit [0a87733](https://github.com/Bimmiest/SplunkToolkit/commit/0a87733ac322f7564d3dbaf29bf82d3f005d3b01).)
- **Diff tab false-positive "Modified"** — `hasChanges` normalises both sides with `.replace(/\r\n/g,'\n').replace(/\s+$/,'')` before comparison.
- **Calc field classification: EVAL beats EXTRACT** — `fieldColorMap` precedence changed to `calc > manual > auto`; `case()` expressions that matched no branch (empty string) and fields that evaluated to `null` are suppressed from the calc strip.
- **Stuck-pin escape hatch** — "Clear" link added next to `N/M events match` counter in `HighlightedTab`.
- **Duplicate event count removed** from `PreviewFilterBar` (duplicated StatusBar's count; filter ratio retained when active).

### Changed

- **Calc Fields sub-tab merged into Extractions tab** — `CalculatedFieldsTab.tsx` deleted; filter row extended to `Auto | Manual | Calculated | All`; `key=value` summary strip and Eval Expressions shown when Calculated or All filter is active.
- **`src/components/preview/tabs/shared/` created** — `useFieldFocus`, `fieldTreeUtils`, `FieldTreeNode`, `HighlightedRaw`, `FieldEventCard`, `FieldSidebar`, `FieldSplitLayout` extracted; ~350 lines of duplication removed.
- **Fields sidebar state** moved inside `HighlightedTab`; `PreviewPanel` no longer owns or passes sidebar props.
- **Sub-tab order** changed to `Raw → Timestamp → Extractions → Diff → Regex`.
- **Favicon accent** corrected from `#60a5fa` to `#6366f1`.

---

## 2026-04-18

### Added

- **Design system: colour tokens** ([index.css](src/index.css)) — zinc-based palette (`#fafafa` / `#18181b` canvas), `--color-bg-elevated` for cards/inputs/editors, indigo accent (`#6366f1` / `#818cf8`), `--color-border-subtle` (semi-transparent) for internal dividers.
- **Monaco `splunk-light` / `splunk-dark` themes** updated to zinc/indigo palette; font size 13→14px; editor background uses `--color-bg-elevated`.
- **IDE-style pane header typography** — uppercase, `tracking-wider`, `text-[var(--color-text-secondary)]` for panel titles; `tracking-wide` without uppercasing for filename headers.
- **MetadataPanel redesigned** — `grid-cols-4` → `grid-cols-2`; per-field Tooltip `(i)` info icons explaining stanza-matching role.
- **Rich `@radix-ui/react-tooltip` tooltips** replacing `title=` attributes on ThemeToggle, CopyButton, ClearButton, and MetadataPanel icons.
- **Polished empty state** in `PreviewPanel` — 2-column sample card grid with hover lift and shadow.
- **RawPanel empty overlay** — terminal icon + instructional copy; disappears on paste.
- **New icons** — `terminal`, `shield`, `clipboard`, `info` added to `Icon.tsx`.
- **Inline `(i)` info icons** on TransformsTab section headers.
- **Monaco completion docs** — examples now render as fenced code blocks in hover tooltips.

### Fixed

- **Directive parser whitespace** — `DIRECTIVE_RE` changed `\s?` to `\s*`; multiple spaces after `=` no longer cause boolean directives to silently flip.
- **`EXTRACT-*` source-field split** — changed lazy `.+?` to greedy `[\s\S]+`; regexes containing `\bin\b` no longer mis-split at the wrong `in` keyword.
- **Transform `FORMAT` pair parser** — replaced `indexOf('::')` approach with `/(\w+)::(?:"([^"]*)"|(\S+))/g` loop; quoted values (`field::"value with spaces"`) now parse correctly.
- **`flattenJson` prototype-pollution guard** — `__proto__`, `constructor`, `prototype` keys skipped before any field assignment.

### Changed

- **Duplicate directive merge in `pipeline.ts`** removed; `mergeDirectives()` output used directly everywhere.
- **`breakLines`** compiles `LINE_BREAKER` once (single `'d'`-flag compile) instead of twice.
- **`expandFormat`** uses module-level `NAMED_REF_PATTERN` regex instead of `new RegExp()` per named group per match.
- **`KV_MODE=json`** probes up to 5 `{` positions on parse failure via `jsonObjectCandidates` generator; a false-positive `{` no longer silently aborts JSON extraction.
- **Internal dividers** softened to `border-[var(--color-border-subtle)]`; TransformsTab cards elevated to `--color-bg-elevated`.

---

## 2026-04-17

### Fixed

- **EVAL `IN` / `NOT IN` operator** — tokenizer now promotes `IN` to an op token; `parseComparison()` handles `field IN (...)` via `parseInList()`. Fixes `eventName IN (...)` patterns used in official Splunkbase TAs (e.g. `aws:cloudtrail`).
- **EVAL single `=` operator** — tokenizer was silently dropping lone `=`; now emits a `=` token treated as equality. Fixes "Expected paren )" errors on `field="value"` comparisons.
- **`INGEST_EVAL` assignment splitting** — now splits on commas (not semicolons) using a paren-aware `splitAssignments()` helper so commas inside function arguments are not treated as separators.
- **`EXTRACT-*` multivalue fields** — now uses `matchAll()` with a global regex; named groups matched more than once produce an array value.
- **`tonumber()` partial string rejection** — validates input against a strict pattern per base before parsing.
- **Worker auto-restart** — re-posts the in-flight request after a crash restart.

### Changed

- **Duplicate stanza-loop in `pipeline.ts`** collapsed — TRANSFORMS/REPORT existence check and `referencedTransforms` collection done in one pass.
- **Linear stanza lookup in `transformsProcessor.ts`** replaced with O(1) `Map`; unused `resolveTransformStanza` export removed.
