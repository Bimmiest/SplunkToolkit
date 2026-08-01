# Contributing

Thanks for looking at this. Most of what follows is already enforced by CI — it is written down here so you do not have to reverse-engineer it from `.github/workflows/ci.yml`.

## Getting set up

Node is pinned in [`.nvmrc`](.nvmrc), matched by `engines` in `package.json`, and used by CI. Use that version; a different major will produce failures that have nothing to do with your change.

```bash
nvm use            # or: fnm use
npm install
npm run dev        # http://localhost:5173
```

## The four checks

CI runs these in order, and a PR needs all of them:

```bash
npm run lint          # ESLint, including type-aware rules
npm run build         # tsc -b && vite build — this is the type-check
npm run test:coverage # vitest, with the coverage floor enforced
npm run test:e2e      # Playwright, against a production build
```

A few things worth knowing:

- **`npm run build` is the type-check.** There is no separate `tsc --noEmit` step, so a type error surfaces as a build failure.
- **The e2e suite runs against `dist/`, not the dev server.** A change that works under `vite dev` and not in a production build will pass locally and fail in CI. On a clean checkout the first run needs the browser: `npx playwright install chromium`.
- **Coverage is a floor, and a ratchet.** The thresholds live in `vitest.config.ts` so a local run gives the same verdict CI does. The engine is held to a higher bar than the app as a whole, because a simulator whose UI is under-tested is annoying while one whose pipeline is under-tested is wrong. Raise the floor when real work raises coverage; do not lower it to make a branch green.

## Where a change goes

| What | Where |
|---|---|
| Simulation logic | `src/engine/` — pure, no React imports, runs under Node and in a Web Worker |
| Directive metadata (description, default, phase, valid values) | `src/engine/directiveRegistry.ts` |
| Whether the engine actually honours a directive | `src/engine/directiveSupport.ts` |
| Editor behaviour (hover, completion, lint markers) | `src/monaco/` |
| UI | `src/components/` |

`src/engine/**` has no runtime dependencies and must keep it that way — it is consumed directly as a library (see the README), not only by this app.

## Adding or changing a simulated directive

This is the part with rules of its own, because the project's whole claim is that its output matches Splunk.

1. **Implement it in `src/engine/`**, with a unit test that asserts the behaviour.
2. **Classify it in `directiveSupport.ts`** as `simulated`, `documented` or `ignored`. This is not optional — a test fails if a registry key is unclassified, and another fails if a `simulated` key is not mentioned by any test. Anything `ignored` needs a tracking issue.
3. **Prefer a fidelity fixture over a reading of the docs.** `src/engine/__tests__/fixtures/corpus.ts` holds cases whose ground truth was captured from a real Splunk instance; see [`scripts/capture-fixtures.md`](scripts/capture-fixtures.md). Several long-standing bugs were reasonable readings of `props.conf.spec` that real Splunk contradicts, so a doc-derived test can encode a wrong answer confidently.
4. **If you cannot capture,** say so in the test's comment and keep the assertion narrow.

Adding a corpus case needs a Splunk instance to capture against. If you do not have one, open an issue describing the case instead — that is genuinely useful on its own.

## Changing behaviour a test already asserts

If a captured fixture disagrees with an existing test, the fixture wins. Update the test, and leave a comment saying which capture corrected it and what the old reading was. Several tests carry exactly that note.

## Commits and PRs

- Explain **why** in the commit body, not just what. The `CHANGELOG.md` entries are written the same way and are a fair guide to the house style.
- Reference issues with a closing keyword **per issue** — `Closes #1, #2` only closes #1.
- Add a `CHANGELOG.md` entry for anything a user would notice.
