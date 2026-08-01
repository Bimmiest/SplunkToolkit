import { test, expect, openApp, loadExample } from './fixtures';

const APACHE = /Apache Access Log/i;

test.describe('boot', () => {
  test('loads with no CSP violation and no console error', async ({ page, complaints }) => {
    await openApp(page);
    await loadExample(page, APACHE);

    // Asserted separately from `all` so the failure message names the cause.
    // This is the regression guard for the missing `img-src`: Monaco draws its
    // error/warning underlines as inline `data:` SVGs, and with only
    // `default-src 'self'` to fall back on the browser refused every one.
    expect(complaints.csp, 'blocked by Content-Security-Policy').toEqual([]);
    expect(complaints.all, 'browser errors during load').toEqual([]);
  });

  test('serves the tightened policy from the built artifact', async ({ page }) => {
    await page.goto('/');
    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');

    expect(policy).toBeTruthy();
    // 'unsafe-eval' was removed once main.tsx moved to monaco's slim
    // editor.api entry; nothing may quietly put it back.
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain('img-src');
  });
});

test.describe('monaco', () => {
  test('mounts three editors and lints what is typed into props.conf', async ({ page, complaints }) => {
    await openApp(page);
    // Raw log, props.conf, transforms.conf.
    await expect(page.locator('.monaco-editor')).toHaveCount(3);

    const propsEditor = page.locator('.monaco-editor').nth(1);
    await propsEditor.click();
    await page.keyboard.type('[my:sourcetype]\nSHOULD_LINEMERGE = notabool\n');

    // A marker proves the whole language pipeline is wired: the model changed,
    // computeDiagnostics ran, and setModelMarkers reached the editor.
    await expect(page.locator('.squiggly-warning, .squiggly-error, .squiggly-info').first())
      .toBeVisible({ timeout: 15_000 });

    expect(complaints.csp, 'blocked by Content-Security-Policy').toEqual([]);
  });
});

test.describe('pipeline worker', () => {
  test('round-trips an example and reports the result in the status bar', async ({ page }) => {
    await openApp(page);
    await loadExample(page, APACHE);

    // The worker is a separately-bundled chunk; that it produced a result at
    // all is the thing under test. The status bar is the only place that
    // reports the counts, so matching them anywhere on the page is unambiguous.
    const shell = page.locator('body');
    await expect(shell).toContainText(/\d+ events?/);
    await expect(shell).toContainText(/\d+ fields?/);

    const text = await shell.innerText();
    expect(Number(/(\d+) events?/.exec(text)?.[1] ?? 0)).toBeGreaterThan(0);
    expect(Number(/(\d+) fields?/.exec(text)?.[1] ?? 0)).toBeGreaterThan(0);
  });

  test('recomputes when props.conf changes', async ({ page }) => {
    await openApp(page);
    await loadExample(page, APACHE);

    const before = await page.getByRole('tab', { name: /^Fields$/ }).click().then(async () => {
      await expect(page.locator('tbody tr').first()).toBeVisible();
      return page.locator('tbody tr').count();
    });

    // Add an EVAL that must produce a new field, then wait for it to appear.
    await page.locator('.monaco-editor').nth(1).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nEVAL-e2e_marker = "present"\n');

    await expect(page.getByText('e2e_marker', { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(before);
  });
});

test.describe('engine output reaches the tabs', () => {
  test('Extractions renders the eval expressions carried on the trace', async ({ page }) => {
    await openApp(page);
    await loadExample(page, APACHE);

    await page.getByRole('tab', { name: /^Extractions$/ }).click();

    // The filter pills are built from the category sets; "All" is their UNION,
    // so it can never exceed the sum and must not double-count.
    const pills = await page.getByRole('button', { name: /^(Auto|Manual|Calculated|All)/ }).allInnerTexts();
    const count = (label: string) =>
      Number(/\((\d+)\)/.exec(pills.find((p) => p.startsWith(label)) ?? '')?.[1] ?? 0);
    expect(count('All')).toBeLessThanOrEqual(count('Auto') + count('Manual') + count('Calculated'));
    expect(count('All')).toBeGreaterThan(0);

    // Expressions come off the EVAL step's `evalExpressions`, not from
    // re-parsing props.conf in the component.
    const evalSection = page.locator('details', { hasText: 'Eval Expressions' }).first();
    await evalSection.locator('summary').click();
    await expect(evalSection).toContainText('if(');
  });

  test('Fields lists rows and an Aliases column fed by the trace', async ({ page }) => {
    await openApp(page);
    await loadExample(page, APACHE);

    await page.getByRole('tab', { name: /^Fields$/ }).click();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    // The column header specifically — "Field Aliases" also appears in the
    // Extractions sidebar, and an example's own description mentions the word.
    await expect(page.locator('thead th', { hasText: 'Aliases' })).toBeVisible();
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(0);
  });

  test('Pipeline lists the processors that ran', async ({ page }) => {
    await openApp(page);
    await loadExample(page, APACHE);

    await page.getByRole('tab', { name: /^Pipeline$/ }).click();
    await expect(page.locator('#main-content')).toContainText(/EXTRACT|EVAL|lineBreaker/);
  });
});

test.describe('accessibility affordances', () => {
  test('the command palette opens, traps focus, and closes on Escape', async ({ page, complaints }) => {
    await openApp(page);

    // Lowercase `k`: Playwright's `Control+K` delivers `e.key === 'K'`, which is
    // also what a real browser reports with Caps Lock on.
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog');
    await expect(palette).toBeVisible();

    // useOverlay marks the modal's siblings inert while it is open.
    await expect(page.locator('#main-content')).toHaveAttribute('aria-hidden', 'true');

    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(page.locator('#main-content')).not.toHaveAttribute('aria-hidden', 'true');

    expect(complaints.all, 'browser errors during overlay interaction').toEqual([]);
  });
});
