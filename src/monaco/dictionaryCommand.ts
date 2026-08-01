/**
 * Monaco command that opens a directive in the dictionary.
 *
 * The id lives in its own module because both ends need it and they cannot
 * import each other: splunkMonacoSetup registers the handler and already
 * imports the hover provider, so the hover provider referencing the id from
 * there would close the cycle.
 */
export const OPEN_DICTIONARY_COMMAND_ID = 'splunkToolkit.openDictionary';

/**
 * Build a `command:` URI for a Markdown link.
 *
 * Monaco only follows these from an IMarkdownString marked `isTrusted`, and it
 * parses the query as a JSON argument list — hence the encoded array rather
 * than a bare string.
 */
export function openDictionaryCommandUri(directiveKey: string): string {
  const args = encodeURIComponent(JSON.stringify([directiveKey]));
  return `command:${OPEN_DICTIONARY_COMMAND_ID}?${args}`;
}
