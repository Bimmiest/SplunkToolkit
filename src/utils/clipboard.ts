/**
 * Copy text to the clipboard, with a fallback for insecure contexts where the
 * async Clipboard API is unavailable. Shared by CopyButton and the context menus.
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Async Clipboard API unavailable (insecure context) — fall back below.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    // execCommand can return false (or throw in a sandboxed iframe) without
    // copying. Propagate that as a rejection so callers don't show a false
    // "copied" confirmation.
    ok = document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
  if (!ok) throw new Error('Copy to clipboard failed');
}
