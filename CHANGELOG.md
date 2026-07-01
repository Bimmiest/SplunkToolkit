# Changelog

All notable changes to Splunk Toolkit are documented here, newest first.

---

## 2026-07-01

### Changed

- **The Regex tab's live tester now runs matching in a terminatable Web Worker** — user regexes previously executed on the main thread (on every keystroke, against every event), where the pipeline's watchdog does not apply, so a catastrophic pattern that slipped the ReDoS heuristic froze the tab with no recovery. Matching now runs in a dedicated worker with a 2 s watchdog: a runaway pattern hangs the worker (not the UI), which is terminated and restarted, and the tab shows a "too slow to evaluate" message and stays responsive. New `matchInputs` engine helper + `useRegexMatch` hook; falls back to inline matching where `Worker` is unavailable (tests/SSR). ([src/engine/regexMatch.ts](src/engine/regexMatch.ts), [src/hooks/useRegexMatch.ts](src/hooks/useRegexMatch.ts), [src/components/preview/tabs/RegexTab.tsx](src/components/preview/tabs/RegexTab.tsx))

### Fixed

- **`safeRegex()`'s ReDoS heuristic missed common catastrophic families, and the Regex tab translated patterns twice** — the heuristic only caught a nested quantified group (`(a+)+`). It now also catches a quantified group with a `{n[,m]}` outer bound (`(.*,){20}`) and adjacent same-atom quantifiers (`a*a*`, `\d+\d+`, long `a*a*a*…` runs), so those documented catastrophic patterns are refused *before* they run on the main thread (where the Web Worker watchdog doesn't apply) rather than freezing the tab. Alternation-overlap forms like `(a|aa)+` are still not heuristically detected (flagging them without rejecting benign `(foo|bar)+` needs a real overlap analysis) — documented in the README. The Regex tab now passes the raw pattern to `safeRegex`/`validateRegex` once instead of pre-translating it itself (the duplicate `convertSplunkToJsRegex` and a stray `'d' as string` cast are gone). ([src/utils/splunkRegex.ts](src/utils/splunkRegex.ts), [src/components/preview/tabs/RegexTab.tsx](src/components/preview/tabs/RegexTab.tsx))

- **Automatic timestamp recognition could pick a date from the message body over the intended leading one** — `autoRecognize` returned the first format (in priority order) that matched *anywhere* in the lookahead window, so a more-specific format matching deep in the text could beat the real timestamp at the front. Candidates are now scored by match position (earliest wins) then format specificity, matching Splunk's positional recognition. ([src/engine/processors/timestampExtractor.ts](src/engine/processors/timestampExtractor.ts))
- **Out-of-range timestamp fields rolled over silently instead of failing to parse** — `%m=13` became the next January, `%d=32`/Feb 30 spilled into the next month, `%H=25` into the next day (via `Date.UTC`). `parseTimestamp` now rejects out-of-range month/day (leap-aware)/hour/minute/second as a parse failure. ([src/utils/strftime.ts](src/utils/strftime.ts))
- **An unresolvable timezone was silently treated as UTC** — `%Z`/`TZ` values not in the small abbreviation table (e.g. an IANA name like `Europe/London`, or an unknown abbreviation) resolved to `0` with no signal, mis-zoning `_time`. Resolution now returns "unresolved", and the timestamp processor emits a one-per-value warning (still falling back to UTC) so the divergence is visible. ([src/utils/strftime.ts](src/utils/strftime.ts))

- **"Create EXTRACT from selection" anchored on the first occurrence of the selected text, not the one picked** — `buildExtractFromSelection` located the selection with `indexOf`, so selecting the second `200` in `status=200 code=200` generated `status=(?<rc>…)` and captured the wrong field. The Raw tab's token selection now threads its real offset (`selection.start`) through `EventContextMenu` → the Extract/TimePrefix dialogs → the scaffold helpers, which derive the prefix from `raw.slice(0, offset)`. The native-selection fallback (no reliable offset) keeps using `indexOf`. ([src/engine/scaffold/fromSelection.ts](src/engine/scaffold/fromSelection.ts))
- **"Create EXTRACT from selection" reported a misleading "invalid regex" for a legal field name** — a field name with a hyphen, dot, or leading digit (all ordinary in Splunk) was dropped straight into a `(?<name>…)` capture group, which fails to compile; the dialog then blamed the regex. Field names are now sanitised into valid capture-group identifiers (illegal chars → `_`, leading digit prefixed), and the dialog notes when the applied field name was adjusted. ([src/components/preview/tabs/shared/ExtractNameDialog.tsx](src/components/preview/tabs/shared/ExtractNameDialog.tsx))

- **Monaco diagnostics dropped errors on the line after any backslash-terminated header or garbage line** — the editor set its "continuation" flag on *every* non-comment line ending in `\`, so `[stanza] \` or a malformed line ending in `\` suppressed validation of the next line. The flag is now armed only after an actual directive line, mirroring `confParser`'s `lastDirective` gating. ([src/monaco/splunkConfDiagnostics.ts](src/monaco/splunkConfDiagnostics.ts))
- **fieldHighlight pointed at the wrong characters when the value text overlapped the key or a larger number** — a context match located the value with `indexOf(value, keyStart)`, which could land inside the key (`{"name":"name"}` → the key), and the numeric fallback used a bare substring match (`10` matched inside `100`). The value is now captured as a regex group (highlighted via match indices), and the fallback requires a word/number boundary. ([src/utils/fieldHighlight.ts](src/utils/fieldHighlight.ts))
- **Stanza specificity ignored literal dots** — `source::`/`host::` patterns treat `.` as a literal (only `*`, `?`, `...` are wildcards), but the specificity score excluded `.`, so `host::a.b.c.d` could lose precedence to a shorter all-literal pattern. Literal dots now count (with `...` still treated as a single wildcard). ([src/engine/parser/stanzaMatcher.ts](src/engine/parser/stanzaMatcher.ts))
- **`TRUNCATE` accepted malformed values via a lenient `parseInt`** — `0x10`→`0` (silently disabled truncation), `1e3`→`1` (truncated every event to ~1 byte), `100abc`→`100` (no warning). The value is now validated as a clean non-negative integer and ignored with a warning otherwise. ([src/engine/processors/truncator.ts](src/engine/processors/truncator.ts))
- **Scaffold could suggest a `TRUNCATE` below the longest event** — the suggestion was derived from `p99 * 1.5`, which with a long tail sat below `maxLen` and would truncate real events. The headroom is now clamped to at least the longest event. ([src/engine/scaffold/analyzers/truncate.ts](src/engine/scaffold/analyzers/truncate.ts))
- **`copyToClipboard` reported success even when the fallback copy failed** — `document.execCommand('copy')` can return `false` (or throw in a sandboxed iframe) without copying, but the result was discarded, so callers could show a false "copied" confirmation. It now rejects when the fallback fails. ([src/utils/clipboard.ts](src/utils/clipboard.ts))

- **eval parser silently discarded trailing tokens and mis-tokenized `expr - n`** — a `-` following a closing paren was lexed as a negative number literal (so `len(x) - 1` became `len(x)` with the `- 1` dropped), and `parse()` never checked for leftover tokens (so malformed input like `1 + 2 foo` was accepted and truncated). The lexer now folds a leading `-` into a numeric literal only at the start / after an operator, comma, or *opening* paren, accepts at most one decimal point (`1.2.3` is now a parse error, not a silent `1.2`), and `parse()` rejects leftover tokens. ([src/engine/processors/evalProcessor.ts](src/engine/processors/evalProcessor.ts))
- **eval coerced non-numeric values to `0`, diverging from Splunk NULL semantics** — `"abc" == 0` evaluated to true, `"abc" * 2` and `abs("foo")` returned `0`, and `tostring("abc", "commas")` returned `"0"`. Arithmetic, unary minus, and the math functions now propagate NULL for a non-numeric (or NULL) operand via a shared `numArg` helper; `compare()` only takes the numeric branch when *both* sides are numeric; and `tostring(value, fmt)` passes a non-numeric value through unchanged. ([src/engine/processors/evalProcessor.ts](src/engine/processors/evalProcessor.ts))

- **KV `auto`/`auto_escaped` extracted phantom fields from inside quoted values** — a `key=value` substring within a quoted value (e.g. `msg="error code=42 occurred"`) was mis-extracted as its own field (`code=42`). The bare `key=value` pass now runs over a copy with quoted spans blanked out, so only real top-level pairs are extracted. ([src/engine/processors/kvMode.ts](src/engine/processors/kvMode.ts))
- **`regexTransform` FORMAT `$N` greedily consumed following digits** — a single-digit group reference immediately followed by a literal digit (e.g. `$10` with only group 1) was parsed as a non-existent multi-digit group and dropped the output. `$N` now resolves with PCRE/JS `$nn` fallback: the longest leading digit-run that names a real group wins; remaining digits are literal (`$10` → group 1 + `0`). ([src/engine/transforms/regexTransform.ts](src/engine/transforms/regexTransform.ts))
- **`INGEST_EVAL` assignment splitting mishandled an escaped backslash before a closing quote** — a value ending in `\\` (e.g. `a="c:\\", b=2`) left the string literal "open", swallowing the following top-level comma and losing `b=2`. The quote-close test now counts the run of trailing backslashes (odd = escaped, even = closes) instead of looking back a single character. ([src/engine/transforms/ingestEval.ts](src/engine/transforms/ingestEval.ts))
- **`destKeyRouter` silently skipped routing when FORMAT expanded to an empty string** — a falsy check treated `destValue === ""` as "no routing", so intentionally blanking `_raw` or anonymising a field to `""` had no effect. It now tests for `undefined` rather than falsiness. ([src/engine/transforms/destKeyRouter.ts](src/engine/transforms/destKeyRouter.ts))
- **`SEDCMD` left a stray backslash when a delimiter was escaped in the replacement** — `s/b/x\/y/` produced `ax\/yc` instead of GNU sed's `ax/yc`. The parser preserves backslashes verbatim, but the replacement builder never unescaped them. Replacement construction is now a single left-to-right pass that resolves sed escapes correctly: `\1`–`\9` stay backreferences, any other `\<char>` (an escaped delimiter, `\\` → `\`, etc.) drops the backslash, and a bare `$` is still escaped so JS doesn't read it as a substitution pattern. This also fixes `\\1` being mis-read as capture-group 1 rather than a literal `\1`. ([src/engine/processors/sedCmd.ts](src/engine/processors/sedCmd.ts))
- **eval `mvzip` padded to the longer field instead of stopping at the shorter** — it now behaves like a true zip, producing only as many values as the shorter field. `mvzip(["a","b","c"], ["1","2"])` → `["a,1","b,2"]` (previously `["a,1","b,2","c,"]`). ([src/engine/processors/evalProcessor.ts](src/engine/processors/evalProcessor.ts))
- **eval `mvcount` returned `0` for a field with no values** — Splunk returns NULL (a single value → 1, multiple → count, no values → NULL). `mvcount` now returns NULL when the field is empty/missing.

### Added

- **eval `isbool()` and `isstr()`** — previously unimplemented (they fell through to the stub default and silently returned null). They now report the value's actual type, mirroring `typeof`'s type model. Both are registered in the Monaco eval-function list. ([src/engine/processors/evalProcessor.ts](src/engine/processors/evalProcessor.ts))

---

## 2026-05-31

### Added

- **Mobile / small-screen layout** — on viewports narrower than `768px` the desktop side-by-side resizable split (which collapsed each column to an unusable width on a phone, causing the Raw panel header, placeholder, footer and metadata to overlap) is replaced by a single-panel-at-a-time view. A new segmented control switches between **Raw**, **props.conf**, **transforms.conf** and **Output**, with each panel getting the full main area. New `useMediaQuery` hook ([src/hooks/useMediaQuery.ts](src/hooks/useMediaQuery.ts)) and `MobileShell` component ([src/components/layout/MobileShell.tsx](src/components/layout/MobileShell.tsx)).

### Fixed

- **Raw Log editor rendered with the default light theme on first load (mobile)** — the custom `splunk-dark`/`splunk-light` Monaco themes were only defined inside `SplunkEditor`'s `beforeMount` (props/transforms), but the Raw Log panel uses a plain editor that references them. On mobile only the Raw tab mounts first, so Monaco fell back to its default white theme until another tab was visited. The theme/language registration is now a shared, idempotent `ensureSplunkMonaco` helper ([src/components/editor/splunkMonacoSetup.ts](src/components/editor/splunkMonacoSetup.ts)) called by every editor's `beforeMount`.
- **First-run banner dismiss button floated mid-height** when the steps wrapped to two rows on narrow screens — it now top-aligns below the `sm` breakpoint and stays centered above it.
- **Output tab bar clipped on small laptop screens** — `Tabs` tablist is now horizontally scrollable (`overflow-x-auto`, `min-w-0`) with non-shrinking, non-wrapping tab buttons (`shrink-0 whitespace-nowrap`), so the Preview/CIM Models/Fields/Pipeline/Architecture tabs no longer wrap or get cut off in narrow output panels.
- **Header crowding on narrow screens** — the "Commands" label and `⌘K` kbd hint collapse to just the search icon below the `sm` breakpoint.

---

## 2026-04-21

### Fixed

- **Collapsed editor header styling inconsistent with expanded state** — icon size (`w-4 h-4` → `w-3.5 h-3.5`) and label typography (`text-sm font-medium text-primary` → `text-xs font-semibold tracking-wide text-secondary`) in `PropsConfEditor` and `TransformsConfEditor` collapsed branches now match the expanded header exactly.
- **Azure SWA workflow: `actions/checkout@v3` bumped to `@v4`** in `build_and_deploy_job` — was inconsistent with the `test` job which already used `@v4`.
- **Azure SWA workflow: `actions/github-script@v6` bumped to `@v7`** — aligns with current release.
- **Azure SWA workflow: indentation normalised** — `permissions` sub-keys and `github-script` `with:` block were using 7/11 spaces; corrected to standard 2-space nesting.
- **Azure SWA workflow: `close_pull_request_job` removed** — PR preview environments disabled; repo is public and open PRs should not auto-deploy staging URLs.

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
