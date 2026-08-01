/// <reference types="vite/client" />

/**
 * The released version, injected at build time from `package.json` (see
 * `vite.config.ts`). Declared here rather than imported so nothing in the app
 * pulls package.json into the bundle.
 *
 * Tests run through vitest.config.ts, which defines it too — a status bar that
 * throws under test because a global is missing would be a silly way to break
 * the suite.
 */
declare const __APP_VERSION__: string;
