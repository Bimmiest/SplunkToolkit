import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * End-to-end smoke tests, run against a PRODUCTION build.
 *
 * These exist to cover the things vitest structurally cannot reach, all of
 * which have failed silently in this repo before:
 *
 *  - **The Content-Security-Policy.** It lives in `index.html` and only takes
 *    effect in a browser. `img-src` was missing for the whole life of the
 *    policy, so Chromium refused every one of Monaco's `data:` squiggle SVGs
 *    and the lint underlines simply did not draw — visible only as a console
 *    error nobody was watching.
 *  - **Worker bundling.** The entire simulation runs in a Web Worker created
 *    with `new Worker(new URL(...), { type: 'module' })`. Whether Vite emits a
 *    loadable chunk for that is a build-time question with a runtime answer.
 *  - **The Monaco chunk split.** `main.tsx` imports the slim `editor.api` entry
 *    and `vite.config.ts` hand-rolls `manualChunks` around it. A bad split
 *    type-checks, builds, and then fails to mount an editor.
 *
 * The server command BUILDS before serving on purpose. Serving a stale `dist/`
 * produces confident, wrong results — a tightened CSP that is not in the
 * artifact reads as a passing test.
 */
export default defineConfig({
  testDir: './e2e',
  // A CI failure caused by a stray `test.only` is worse than the inconvenience.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The suite is small and the server is shared; parallelism buys little and
  // makes the console-error assertions harder to attribute.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `--host 127.0.0.1` is not redundant with the port. `vite preview` binds
    // `localhost` by default, which on a GitHub Actions runner resolves to `::1`
    // first — so the server comes up on IPv6 only and `BASE_URL`'s 127.0.0.1 is
    // never reachable. The symptom is a webServer timeout with a completely
    // healthy build in the log directly above it.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Piped, not ignored: the server's own startup line ("Local: http://…") is
    // what distinguishes "never bound" from "bound somewhere else", and
    // discarding it is what made the failure above take a log-read to diagnose.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
