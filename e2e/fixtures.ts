import { test as base, expect, type Page } from '@playwright/test';

/**
 * Everything the browser complained about during a test.
 *
 * Collected rather than asserted eagerly so a test can read the list and say
 * something specific about it ("no CSP violation") instead of every failure
 * arriving as an undifferentiated "there was a console error".
 */
export interface BrowserComplaints {
  all: string[];
  /** The subset Chromium attributes to a Content-Security-Policy directive. */
  csp: string[];
}

export const test = base.extend<{ complaints: BrowserComplaints }>({
  complaints: async ({ page }, use) => {
    const all: string[] = [];
    const csp: string[] = [];

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      all.push(`console.error: ${text}`);
      // Chromium's wording for every blocked-by-policy subresource.
      if (/Content Security Policy|Refused to (load|execute|connect|frame)/i.test(text)) {
        csp.push(text);
      }
    });
    page.on('pageerror', (error) => all.push(`pageerror: ${error.message}`));

    await use({ all, csp });
  },
});

export { expect };

/**
 * Open the app and wait for it to be interactive: the shell rendered and all
 * three Monaco editors mounted.
 *
 * Monaco is the slowest thing on the page and the most likely to be broken by a
 * bundling change, so waiting on it is both the readiness signal and an
 * assertion.
 */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#main-content')).toBeVisible();
  await expect(page.locator('.monaco-editor').nth(2)).toBeVisible({ timeout: 30_000 });
}

/**
 * Load a built-in example and wait for the pipeline worker to return ITS result.
 *
 * The readiness signal is a NON-ZERO event count, not "Worker idle" and not a
 * sleep. The app runs the pipeline once on mount with an empty raw log, and
 * `runPipeline` returns a real result for empty input — `eventCount: 0` — so
 * the status bar already reads "Worker idle · 0 events" before the example is
 * clicked. Waiting on that is a race the test wins often enough to look stable
 * and loses whenever the machine is slow, which is the worst failure mode an
 * end-to-end suite can have.
 */
export async function loadExample(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('button', { name }).first().click();
  await expect(page.getByText(/^[1-9]\d* events?$/)).toBeVisible({ timeout: 30_000 });
}
