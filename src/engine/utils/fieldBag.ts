/**
 * Helpers for writing user-controlled field names into a plain-object "field
 * bag" (`Record<string, string | string[]>`).
 *
 * A plain object inherits every `Object.prototype` member, so naive patterns
 * misbehave on JSON/KV keys that happen to collide with them:
 *
 *  - `fields[name] === undefined` reads back the *inherited* `toString` /
 *    `valueOf` / `constructor` function instead of `undefined`, so a real
 *    extraction is silently dropped (or promoted to a bogus multivalue that
 *    leaks a JS function into the field value).
 *  - `fields[name] = value` for `name === '__proto__'` routes through the
 *    inherited `__proto__` setter and mutates the object's prototype instead of
 *    creating a data property, so the field never appears.
 *
 * These helpers are `hasOwnProperty`-guarded and special-case `__proto__` via
 * `Object.defineProperty`, so keys like `toString`, `constructor`, `prototype`
 * and `__proto__` are treated as ordinary fields — matching Splunk's
 * `spath` / `KV_MODE` / `INDEXED_EXTRACTIONS`, which extract them verbatim.
 */

const hasOwn = Object.prototype.hasOwnProperty;

/** True when `name` is an own (not inherited) property of `fields`. */
export function hasField(fields: object, name: string): boolean {
  return hasOwn.call(fields, name);
}

/**
 * Assign an own data property. Handles `__proto__`, which a bare
 * `fields[name] = value` would route to the prototype setter.
 */
export function setField<T>(fields: Record<string, T>, name: string, value: T): void {
  if (name === '__proto__') {
    Object.defineProperty(fields, name, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return;
  }
  fields[name] = value;
}

/**
 * Append `value` to field `name`, promoting to a multivalue array on a repeated
 * key (matching Splunk's multivalue accumulation).
 *
 * Returns `true` when the field was newly created, so callers that track an
 * "added" list can push conditionally.
 *
 * The array is replaced rather than appended to in place. Callers build their
 * field bag with a shallow copy (`{ ...event.fields }`), which shares every
 * array value with the input event — pushing would mutate that event, and any
 * other event holding the same reference, from what is supposed to be a pure
 * processor.
 */
export function addFieldValue(
  fields: Record<string, string | string[]>,
  name: string,
  value: string,
): boolean {
  if (!hasField(fields, name)) {
    setField(fields, name, value);
    return true;
  }
  const existing = fields[name];
  setField(fields, name, Array.isArray(existing) ? [...existing, value] : [existing as string, value]);
  return false;
}
