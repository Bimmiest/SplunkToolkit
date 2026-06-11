import type { SplunkEvent, ConfDirective, ValidationDiagnostic } from '../types';
import { safeRegex } from '../../utils/splunkRegex';
import { fieldQuotingWarning } from '../utils/fieldRef';

type EvalValue = string | number | boolean | null | string[];

export function applyEvalExpressions(
  events: SplunkEvent[],
  directives: ConfDirective[],
  diagnostics?: ValidationDiagnostic[],
): SplunkEvent[] {
  const evalDirectives = directives.filter((d) => d.directiveType === 'EVAL');

  if (evalDirectives.length === 0) return events;

  // Collect per-directive errors/warnings once to avoid O(events) duplicates.
  const reportedErrors = new Set<string>();
  const reportedStubs = new Set<string>();
  const reportedDotted = new Set<string>();

  // Hint for the common mistake of referencing a nested JSON field unquoted: the
  // `.` is the concat operator, so `event.field` won't read the field named
  // `event.field`. Only warn when the bare dotted name (outside quotes) actually
  // matches an extracted field — high precision, no false positives on real concat.
  if (diagnostics) {
    const allFieldNames = new Set<string>();
    for (const ev of events) {
      for (const k of Object.keys(ev.fields)) allFieldNames.add(k);
    }
    for (const dir of evalDirectives) {
      const fieldName = dir.className ?? '';
      if (!fieldName) continue;
      const outsideQuotes = dir.value.replace(/'[^']*'|"[^"]*"/g, '');
      const dottedRefs = outsideQuotes.match(/[A-Za-z_]\w*(?:\.\w+)+/g) ?? [];
      const hit = dottedRefs.find((r) => allFieldNames.has(r));
      if (hit && !reportedDotted.has(`${fieldName}|${hit}`)) {
        reportedDotted.add(`${fieldName}|${hit}`);
        diagnostics.push(
          fieldQuotingWarning(dir, hit, 'is read as concatenation (. is the concat operator), not a field reference'),
        );
      }
    }
  }

  const pushStub = (dir: ConfDirective, fn: string) => {
    if (diagnostics && !reportedStubs.has(fn)) {
      reportedStubs.add(fn);
      diagnostics.push({
        level: 'warning',
        message: `${fn}() is not fully simulated — results may differ from real Splunk`,
        file: 'props.conf',
        line: dir.line,
        directiveKey: dir.key,
      });
    }
  };
  const pushError = (dir: ConfDirective, fieldName: string, msg: string) => {
    if (diagnostics && !reportedErrors.has(fieldName)) {
      reportedErrors.add(fieldName);
      diagnostics.push({
        level: 'error',
        message: `EVAL-${fieldName}: ${msg}`,
        file: 'props.conf',
        line: dir.line,
        directiveKey: dir.key,
      });
    }
  };

  // Parse each directive's expression once into an AST; per-event evaluation
  // reuses it (SEM-8: parse-once-per-directive instead of re-tokenising every
  // event). The AST also enables lazy evaluation of branching functions.
  const compiled = evalDirectives
    .filter((dir) => (dir.className ?? '') !== '')
    .map((dir) => {
      const fieldName = dir.className as string;
      try {
        return { dir, fieldName, ast: parseExpression(dir.value.trim()), error: null as string | null };
      } catch (err) {
        return { dir, fieldName, ast: null, error: err instanceof Error ? err.message : String(err) };
      }
    });

  return events.map((event) => {
    // Eval expressions run in parallel — compute all before applying
    const results = new Map<string, EvalValue>();

    for (const c of compiled) {
      if (c.error !== null) {
        pushError(c.dir, c.fieldName, c.error);
        continue;
      }
      try {
        const value = evalNode(c.ast!, { event, onStubWarning: (fn) => pushStub(c.dir, fn) });
        results.set(c.fieldName, value);
      } catch (err) {
        pushError(c.dir, c.fieldName, err instanceof Error ? err.message : String(err));
      }
    }

    if (results.size === 0) return event;

    const newFields = { ...event.fields };
    const added: string[] = [];

    for (const [field, value] of results) {
      if (value === null) {
        delete newFields[field];
      } else if (Array.isArray(value)) {
        newFields[field] = value;
      } else {
        newFields[field] = String(value);
      }
      added.push(field);
    }

    return {
      ...event,
      fields: newFields,
      processingTrace: [
        ...event.processingTrace,
        {
          processor: 'EVAL',
          phase: 'search-time' as const,
          description: `Computed fields: ${added.join(', ')}`,
          fieldsAdded: added,
        },
      ],
    };
  });
}

// ── Tokenizer ───────────────────────────────────────────

type TokenType = 'string' | 'number' | 'ident' | 'field_ref' | 'op' | 'paren' | 'comma' | 'dot';

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    // Skip whitespace
    if (/\s/.test(expr[i])) { i++; continue; }

    // Double-quoted string literals
    if (expr[i] === '"') {
      let str = '';
      i++;
      while (i < expr.length && expr[i] !== '"') {
        if (expr[i] === '\\' && i + 1 < expr.length) {
          i++;
          if (expr[i] === 'n') str += '\n';
          else if (expr[i] === 't') str += '\t';
          else str += expr[i];
        } else {
          str += expr[i];
        }
        i++;
      }
      i++; // skip closing quote
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Single-quoted field references (Splunk uses '' for field names with special chars)
    if (expr[i] === "'") {
      let name = '';
      i++;
      while (i < expr.length && expr[i] !== "'") {
        name += expr[i];
        i++;
      }
      i++; // skip closing quote
      tokens.push({ type: 'field_ref', value: name });
      continue;
    }

    // Numbers
    if (/\d/.test(expr[i]) || (expr[i] === '-' && i + 1 < expr.length && /\d/.test(expr[i + 1]) && (tokens.length === 0 || tokens[tokens.length - 1].type === 'op' || tokens[tokens.length - 1].type === 'paren' || tokens[tokens.length - 1].type === 'comma'))) {
      let num = '';
      if (expr[i] === '-') { num += '-'; i++; }
      while (i < expr.length && /[\d.]/.test(expr[i])) {
        num += expr[i]; i++;
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Operators
    if (expr[i] === '.' && (i + 1 >= expr.length || !/\d/.test(expr[i + 1]))) {
      tokens.push({ type: 'dot', value: '.' }); i++; continue;
    }

    const twoChar = expr.substring(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(twoChar)) {
      tokens.push({ type: 'op', value: twoChar }); i += 2; continue;
    }

    if (['+', '-', '*', '/', '%', '<', '>', '!'].includes(expr[i])) {
      tokens.push({ type: 'op', value: expr[i] }); i++; continue;
    }

    if (expr[i] === '=') {
      tokens.push({ type: 'op', value: '=' }); i++; continue;
    }

    // Parens
    if (expr[i] === '(' || expr[i] === ')') {
      tokens.push({ type: 'paren', value: expr[i] }); i++; continue;
    }

    // Comma
    if (expr[i] === ',') {
      tokens.push({ type: 'comma', value: ',' }); i++; continue;
    }

    // Identifiers and keywords. A bare identifier stops at `.` — in Splunk eval the
    // period is the concatenation operator, so `event.field` is `event . field`
    // (concat the fields `event` and `field`), NOT a reference to a field literally
    // named `event.field`. Field names containing a period must be single-quoted
    // ('event.field'), which the field_ref branch above handles.
    if (/[a-zA-Z_]/.test(expr[i])) {
      let ident = '';
      while (i < expr.length && /\w/.test(expr[i])) {
        ident += expr[i]; i++;
      }
      const upper = ident.toUpperCase();
      if (upper === 'AND' || upper === 'OR' || upper === 'NOT' || upper === 'IN') {
        tokens.push({ type: 'op', value: upper });
      } else {
        tokens.push({ type: 'ident', value: ident });
      }
      continue;
    }

    // Unknown character, skip
    i++;
  }

  return tokens;
}

// ── AST ─────────────────────────────────────────────────
//
// The parser builds an AST (no event bound) so it can run once per directive,
// and the evaluator walks it per event. Keeping parse and eval separate is also
// what lets branching functions (if/case/coalesce/validate) and AND/OR evaluate
// lazily — Splunk only evaluates the branch it actually takes.

type Node =
  | { kind: 'lit'; value: EvalValue }
  | { kind: 'field'; name: string }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'arith'; op: string; left: Node; right: Node }
  | { kind: 'concat'; left: Node; right: Node }
  | { kind: 'compare'; op: string; left: Node; right: Node }
  | { kind: 'logical'; op: 'AND' | 'OR'; left: Node; right: Node }
  | { kind: 'not'; operand: Node }
  | { kind: 'neg'; operand: Node }
  | { kind: 'in'; value: Node; list: Node[]; negate: boolean };

// ── Parser ──────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;
  private depth = 0;
  private static readonly MAX_DEPTH = 50;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType, value?: string): Token {
    const tok = this.consume();
    if (!tok || tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new Error(`Expected ${type} ${value ?? ''}`);
    }
    return tok;
  }

  parse(): Node {
    return this.parseOr();
  }

  private parseOr(): Node {
    // Depth guard only covers OR-level nesting; flat chains via parseAddSub/parseMulDiv
    // do not increment depth. The worker watchdog (5 s) is the primary protection
    // against pathological inputs that slip through.
    if (++this.depth > Parser.MAX_DEPTH) {
      throw new Error('Expression nesting depth limit exceeded (max 50)');
    }
    try {
      let left = this.parseAnd();
      while (this.peek()?.value === 'OR' || this.peek()?.value === '||') {
        this.consume();
        const right = this.parseAnd();
        left = { kind: 'logical', op: 'OR', left, right };
      }
      return left;
    } finally {
      this.depth--;
    }
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.peek()?.value === 'AND' || this.peek()?.value === '&&') {
      this.consume();
      const right = this.parseNot();
      left = { kind: 'logical', op: 'AND', left, right };
    }
    return left;
  }

  private parseNot(): Node {
    if (this.peek()?.value === 'NOT' || this.peek()?.value === '!') {
      this.consume();
      return { kind: 'not', operand: this.parseComparison() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const left = this.parseConcat();
    const tok = this.peek();

    // IN / NOT IN
    if (tok?.type === 'op' && tok.value === 'IN') {
      this.consume();
      return this.parseInList(left, false);
    }
    if (tok?.type === 'op' && tok.value === 'NOT' && this.tokens[this.pos + 1]?.value === 'IN') {
      this.consume(); // NOT
      this.consume(); // IN
      return this.parseInList(left, true);
    }

    if (tok?.type === 'op' && ['==', '=', '!=', '<', '>', '<=', '>='].includes(tok.value)) {
      const op = this.consume().value;
      const right = this.parseConcat();
      return { kind: 'compare', op, left, right };
    }
    return left;
  }

  private parseInList(left: Node, negate: boolean): Node {
    this.expect('paren', '(');
    const list: Node[] = [];
    if (this.peek()?.type !== 'paren' || this.peek()?.value !== ')') {
      list.push(this.parseOr());
      while (this.peek()?.type === 'comma') {
        this.consume();
        list.push(this.parseOr());
      }
    }
    this.expect('paren', ')');
    return { kind: 'in', value: left, list, negate };
  }

  private parseConcat(): Node {
    let left = this.parseAddSub();
    while (this.peek()?.type === 'dot') {
      this.consume();
      const right = this.parseAddSub();
      left = { kind: 'concat', left, right };
    }
    return left;
  }

  private parseAddSub(): Node {
    let left = this.parseMulDiv();
    while (this.peek()?.type === 'op' && (this.peek()?.value === '+' || this.peek()?.value === '-')) {
      const op = this.consume().value;
      const right = this.parseMulDiv();
      left = { kind: 'arith', op, left, right };
    }
    return left;
  }

  private parseMulDiv(): Node {
    let left = this.parseUnary();
    while (this.peek()?.type === 'op' && ['*', '/', '%'].includes(this.peek()!.value)) {
      const op = this.consume().value;
      const right = this.parseUnary();
      left = { kind: 'arith', op, left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.peek()?.type === 'op' && this.peek()?.value === '-') {
      this.consume();
      return { kind: 'neg', operand: this.parsePrimary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const tok = this.peek();
    if (!tok) throw new Error('Unexpected end of expression');

    // Parenthesized expression
    if (tok.type === 'paren' && tok.value === '(') {
      this.consume();
      const val = this.parseOr();
      this.expect('paren', ')');
      return val;
    }

    // String literal
    if (tok.type === 'string') {
      return { kind: 'lit', value: this.consume().value };
    }

    // Single-quoted field reference
    if (tok.type === 'field_ref') {
      return { kind: 'field', name: this.consume().value };
    }

    // Number literal
    if (tok.type === 'number') {
      return { kind: 'lit', value: parseFloat(this.consume().value) };
    }

    // Function call or field reference
    if (tok.type === 'ident') {
      const name = this.consume().value;

      // Check for function call
      if (this.peek()?.type === 'paren' && this.peek()?.value === '(') {
        this.consume(); // (
        const args: Node[] = [];
        if (this.peek()?.type !== 'paren' || this.peek()?.value !== ')') {
          args.push(this.parseOr());
          while (this.peek()?.type === 'comma') {
            this.consume();
            args.push(this.parseOr());
          }
        }
        this.expect('paren', ')');
        return { kind: 'call', name, args };
      }

      // Boolean literals
      if (name === 'true') return { kind: 'lit', value: true };
      if (name === 'false') return { kind: 'lit', value: false };

      // Field reference
      return { kind: 'field', name };
    }

    throw new Error(`Unexpected token: ${tok.value}`);
  }
}

// ── Evaluator ───────────────────────────────────────────

interface EvalCtx {
  event: SplunkEvent;
  onStubWarning?: ((fn: string) => void) | undefined;
}

function getField(event: SplunkEvent, name: string): EvalValue {
  if (name === '_raw') return event._raw;
  if (name === '_time') return event._time ? event._time.getTime() / 1000 : null;
  const val = event.fields[name];
  if (val === undefined) return null;
  if (Array.isArray(val)) return val;
  return val;
}

function evalNode(node: Node, ctx: EvalCtx): EvalValue {
  switch (node.kind) {
    case 'lit':
      return node.value;
    case 'field':
      return getField(ctx.event, node.name);
    case 'concat':
      return toStr(evalNode(node.left, ctx)) + toStr(evalNode(node.right, ctx));
    case 'arith': {
      const l = evalNode(node.left, ctx);
      const r = evalNode(node.right, ctx);
      return node.op === '+' ? addOrConcat(l, r) : arith(l, r, node.op as '-' | '*' | '/' | '%');
    }
    case 'compare':
      return compare(evalNode(node.left, ctx), evalNode(node.right, ctx), node.op);
    case 'neg': {
      const v = evalNode(node.operand, ctx);
      // NULL propagates through arithmetic (Splunk): -null = null.
      return v === null || v === undefined ? null : -toNum(v);
    }
    case 'not':
      return !toBool(evalNode(node.operand, ctx));
    case 'logical': {
      // Short-circuit: Splunk does not evaluate the right operand once the left
      // settles the result. Both operators yield a boolean.
      const left = evalNode(node.left, ctx);
      if (node.op === 'OR') return toBool(left) ? true : toBool(evalNode(node.right, ctx));
      return !toBool(left) ? false : toBool(evalNode(node.right, ctx));
    }
    case 'in': {
      const left = evalNode(node.value, ctx);
      // `some` stops at the first match — no need to evaluate the rest of the list.
      const match = node.list.some((n) => compare(left, evalNode(n, ctx), '='));
      return node.negate ? !match : match;
    }
    case 'call':
      return evalCall(node.name, node.args, ctx);
  }
}

/**
 * Dispatch a function call. Branching functions evaluate their argument *nodes*
 * lazily (only the taken branch), matching Splunk; everything else evaluates all
 * arguments first and hands the values to {@link evalBuiltin}.
 */
function evalCall(name: string, argNodes: Node[], ctx: EvalCtx): EvalValue {
  const fn = name.toLowerCase();
  switch (fn) {
    case 'if':
      if (toBool(evalNode(argNodes[0], ctx))) {
        return argNodes[1] !== undefined ? evalNode(argNodes[1], ctx) : null;
      }
      return argNodes[2] !== undefined ? evalNode(argNodes[2], ctx) : null;
    case 'case':
      for (let i = 0; i + 1 < argNodes.length; i += 2) {
        if (toBool(evalNode(argNodes[i], ctx))) return evalNode(argNodes[i + 1], ctx);
      }
      return null;
    case 'validate':
      for (let i = 0; i + 1 < argNodes.length; i += 2) {
        if (!toBool(evalNode(argNodes[i], ctx))) return evalNode(argNodes[i + 1], ctx);
      }
      return null;
    case 'coalesce':
      for (const n of argNodes) {
        const v = evalNode(n, ctx);
        if (v !== null && v !== undefined) return v;
      }
      return null;
    default:
      return evalBuiltin(fn, argNodes.map((n) => evalNode(n, ctx)), ctx);
  }
}

/** Non-branching functions: all arguments are already evaluated. */
function evalBuiltin(fn: string, args: EvalValue[], ctx: EvalCtx): EvalValue {
  switch (fn) {
    case 'nullif': return toStr(args[0]) === toStr(args[1]) ? null : args[0];

    // String
    case 'lower': return toStr(args[0]).toLowerCase();
    case 'upper': return toStr(args[0]).toUpperCase();
    case 'len': return toStr(args[0]).length;
    case 'substr': {
      const s = toStr(args[0]);
      const start = toNum(args[1]);
      const startIdx = start > 0 ? start - 1 : s.length + start;
      const len = args[2] !== undefined ? toNum(args[2]) : undefined;
      return len !== undefined ? s.substring(startIdx, startIdx + len) : s.substring(startIdx);
    }
    case 'replace': {
      const s = toStr(args[0]);
      const regex = safeRegex(toStr(args[1]), 'g');
      if (!regex) return s;
      return s.replace(regex, toStr(args[2]));
    }
    case 'trim': return toStr(args[0]).trim();
    case 'ltrim': {
      const s = toStr(args[0]);
      const chars = args[1] !== undefined ? toStr(args[1]) : ' \t\n\r';
      let i = 0;
      while (i < s.length && chars.includes(s[i])) i++;
      return s.substring(i);
    }
    case 'rtrim': {
      const s = toStr(args[0]);
      const chars = args[1] !== undefined ? toStr(args[1]) : ' \t\n\r';
      let i = s.length - 1;
      while (i >= 0 && chars.includes(s[i])) i--;
      return s.substring(0, i + 1);
    }
    case 'urldecode': {
      try { return decodeURIComponent(toStr(args[0])); }
      catch { return toStr(args[0]); }
    }
    case 'split': {
      const s = toStr(args[0]);
      const delim = toStr(args[1]);
      return s.split(delim);
    }
    case 'mvjoin': {
      const v = toMv(args[0]);
      return v.join(toStr(args[1]));
    }

    // Type
    case 'tonumber': {
      const val = toStr(args[0]).trim();
      const base = args[1] !== undefined ? Math.floor(toNum(args[1])) : 10;
      if (base === 10) {
        if (!/^-?\d+(\.\d+)?$/.test(val)) return null;
        return parseFloat(val);
      }
      const validChars = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, base);
      if (!new RegExp(`^[${validChars}]+$`, 'i').test(val)) return null;
      const n = parseInt(val, base);
      return isNaN(n) ? null : n;
    }
    case 'tostring': {
      if (args[1] !== undefined) {
        const format = toStr(args[1]);
        const val = toNum(args[0]);
        if (format === 'hex') return '0x' + Math.floor(val).toString(16);
        if (format === 'commas') {
          // Thousands separators, up to two decimals. Splunk shows no decimals
          // for integers (e.g. 12,345) but keeps fractional precision (rounded
          // to 2 places) when present.
          return val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        }
        if (format === 'duration') {
          const pad = (n: number) => String(n).padStart(2, '0');
          const total = Math.floor(Math.abs(val));
          const days = Math.floor(total / 86400);
          const h = Math.floor((total % 86400) / 3600);
          const m = Math.floor((total % 3600) / 60);
          const s = total % 60;
          const sign = val < 0 ? '-' : '';
          const hms = `${pad(h)}:${pad(m)}:${pad(s)}`;
          return days > 0 ? `${sign}${days}+${hms}` : `${sign}${hms}`;
        }
      }
      return toStr(args[0]);
    }
    case 'typeof': {
      // Splunk returns "Number" | "String" | "Bool" | "Invalid"
      // (a null / nonexistent field is "Invalid", not a separate null type).
      if (args[0] === null || args[0] === undefined) return 'Invalid';
      if (typeof args[0] === 'number') return 'Number';
      if (typeof args[0] === 'boolean') return 'Bool';
      if (Array.isArray(args[0])) return 'MultiValue';
      return 'String';
    }
    case 'isnull': return args[0] === null || args[0] === undefined;
    case 'isnotnull': return args[0] !== null && args[0] !== undefined;
    case 'isint': return isNumericValue(args[0]) && Number.isInteger(Number(args[0]));
    case 'isnum': return isNumericValue(args[0]);

    // Math
    case 'abs': return Math.abs(toNum(args[0]));
    case 'ceiling': case 'ceil': return Math.ceil(toNum(args[0]));
    case 'floor': return Math.floor(toNum(args[0]));
    case 'round': {
      const val = toNum(args[0]);
      const decimals = args[1] !== undefined ? toNum(args[1]) : 0;
      const factor = Math.pow(10, decimals);
      // Splunk rounds halves away from zero; JS Math.round rounds toward +∞.
      const scaled = val * factor;
      return (Math.sign(scaled) * Math.round(Math.abs(scaled))) / factor;
    }
    case 'sqrt': return Math.sqrt(toNum(args[0]));
    case 'pow': return Math.pow(toNum(args[0]), toNum(args[1]));
    case 'log': {
      const val = toNum(args[0]);
      const base = args[1] !== undefined ? toNum(args[1]) : 10;
      return Math.log(val) / Math.log(base);
    }
    case 'ln': return Math.log(toNum(args[0]));
    case 'exp': return Math.exp(toNum(args[0]));
    case 'pi': return Math.PI;
    case 'exact': return toNum(args[0]);
    case 'min': return minMax(args, 'min');
    case 'max': return minMax(args, 'max');
    case 'random': return Math.floor(Math.random() * 2147483648); // 0 .. 2^31-1, like Splunk
    case 'sigfig': return toNum(args[0]);

    // Multivalue
    case 'mvcount': return toMv(args[0]).length;
    case 'mvindex': {
      const mv = toMv(args[0]);
      const n = mv.length;
      // Splunk mvindex is 0-based; negative indices count from the end (-1 = last).
      const norm = (idx: number) => (idx < 0 ? n + idx : idx);
      const start = norm(toNum(args[1]));
      const end = args[2] !== undefined ? norm(toNum(args[2])) : start;
      // Out-of-range or inverted ranges yield NULL.
      if (start < 0 || start >= n || end < 0 || end >= n || end < start) return null;
      return start === end ? mv[start] : mv.slice(start, end + 1);
    }
    case 'mvfilter':
      ctx.onStubWarning?.('mvfilter');
      return toMv(args[0]);
    case 'mvappend': return args.flatMap(toMv);
    case 'mvdedup': return [...new Set(toMv(args[0]))];
    case 'mvfind': {
      const mv = toMv(args[0]);
      const regex = safeRegex(toStr(args[1]));
      if (!regex) return null;
      const idx = mv.findIndex((v) => regex.test(v));
      return idx >= 0 ? idx : null;
    }
    case 'mvsort': return [...toMv(args[0])].sort();
    case 'mvzip': {
      const a = toMv(args[0]);
      const b = toMv(args[1]);
      const delim = args[2] !== undefined ? toStr(args[2]) : ',';
      const len = Math.max(a.length, b.length);
      const result: string[] = [];
      for (let i = 0; i < len; i++) {
        result.push((a[i] ?? '') + delim + (b[i] ?? ''));
      }
      return result;
    }

    // Crypto — not simulated (crypto.subtle is async; eval is sync).
    // Return a visible placeholder so the field is set and users see the stub rather than a silent deletion.
    case 'md5':   ctx.onStubWarning?.('md5');    return '[md5() not simulated]';
    case 'sha1':  ctx.onStubWarning?.('sha1');   return '[sha1() not simulated]';
    case 'sha256': ctx.onStubWarning?.('sha256'); return '[sha256() not simulated]';
    case 'sha512': ctx.onStubWarning?.('sha512'); return '[sha512() not simulated]';

    // Time
    case 'now': return Math.floor(Date.now() / 1000);
    case 'time': return Math.floor(Date.now() / 1000);
    case 'strftime': {
      const epoch = toNum(args[0]);
      const format = toStr(args[1]);
      const date = new Date(epoch * 1000);
      return simpleStrftime(date, format);
    }
    case 'strptime':
      ctx.onStubWarning?.('strptime');
      return toStr(args[0]);
    case 'relative_time':
      ctx.onStubWarning?.('relative_time');
      return toNum(args[0]);

    // Other
    case 'null': return null;
    case 'like': {
      const value = toStr(args[0]);
      // Escape regex metacharacters first, then translate SQL-style wildcards
      const pattern = toStr(args[1])
        .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.');
      // Splunk's like() is case-sensitive.
      const regex = safeRegex(`^${pattern}$`);
      return regex ? regex.test(value) : false;
    }
    case 'match': {
      const regex = safeRegex(toStr(args[1]));
      return regex ? regex.test(toStr(args[0])) : false;
    }
    case 'cidrmatch':
      ctx.onStubWarning?.('cidrmatch');
      return false;
    case 'searchmatch':
      ctx.onStubWarning?.('searchmatch');
      return false;

    default:
      // Unknown or not-yet-simulated function — surface a warning rather than
      // silently returning null (which looks like the field just didn't compute).
      ctx.onStubWarning?.(fn);
      return null;
  }
}

// ── Helpers ─────────────────────────────────────────────

function toBool(v: EvalValue): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0 && v !== '0' && v.toLowerCase() !== 'false';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function toNum(v: EvalValue): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  if (Array.isArray(v)) return v.length > 0 ? toNum(v[0]) : 0;
  return 0;
}

function toStr(v: EvalValue): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(' ');
  return String(v);
}

/**
 * The `+` operator. Splunk propagates NULL through arithmetic (null + x = null),
 * adds when both operands are numeric, and otherwise CONCATENATES strings
 * (`"a" + "b"` → "ab"). `.` is the dedicated concat operator, but `+` falls back
 * to concatenation rather than coercing strings to 0.
 */
function addOrConcat(l: EvalValue, r: EvalValue): EvalValue {
  if (l === null || l === undefined || r === null || r === undefined) return null;
  if (isNumericValue(l) && isNumericValue(r)) return toNum(l) + toNum(r);
  return toStr(l) + toStr(r);
}

/** `-`, `*`, `/`, `%` with NULL propagation (null operand → null result). */
function arith(l: EvalValue, r: EvalValue, op: '-' | '*' | '/' | '%'): EvalValue {
  if (l === null || l === undefined || r === null || r === undefined) return null;
  const a = toNum(l);
  const b = toNum(r);
  switch (op) {
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b !== 0 ? a / b : null;
    case '%': return b !== 0 ? a % b : null;
  }
}

function toMv(v: EvalValue): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v === null || v === undefined) return [];
  return [String(v)];
}

function isNumericString(v: EvalValue): boolean {
  if (typeof v !== 'string' || v === '') return false;
  return !isNaN(Number(v));
}

/**
 * True when the value is genuinely numeric — a number, or a string that parses
 * cleanly as one. Used by isnum()/isint(); unlike toNum() it does not coerce
 * non-numeric input to 0 (which made isnum("abc") wrongly return true).
 */
function isNumericValue(v: EvalValue): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  return isNumericString(v);
}

/**
 * Splunk ordering for min()/max(): numeric values compare numerically, strings
 * compare lexicographically, and any number is considered less than any string.
 * Returns <0 if a<b, >0 if a>b, 0 if equal.
 */
function compareEvalValues(a: EvalValue, b: EvalValue): number {
  const aNum = isNumericValue(a);
  const bNum = isNumericValue(b);
  if (aNum && bNum) return Number(a) - Number(b);
  if (aNum) return -1; // number < string
  if (bNum) return 1;
  const as = toStr(a);
  const bs = toStr(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/** min()/max() over scalars and multivalue args, using Splunk's mixed-type ordering. */
function minMax(args: EvalValue[], which: 'min' | 'max'): EvalValue {
  const vals = args
    .flatMap((a) => (Array.isArray(a) ? a : [a]))
    .filter((v) => v !== null && v !== undefined);
  if (vals.length === 0) return null;
  let best = vals[0];
  for (let i = 1; i < vals.length; i++) {
    const cmp = compareEvalValues(vals[i], best);
    if (which === 'min' ? cmp < 0 : cmp > 0) best = vals[i];
  }
  return best;
}

function compare(left: EvalValue, right: EvalValue, op: string): boolean {
  // Splunk eval: compare numerically if either side is a number, or if both
  // sides are strings that look numeric (e.g. field values from parsed events).
  const bothNumeric =
    typeof left === 'number' ||
    typeof right === 'number' ||
    (isNumericString(left) && isNumericString(right));

  const l = bothNumeric ? toNum(left) : toStr(left);
  const r = bothNumeric ? toNum(right) : toStr(right);

  switch (op) {
    case '==': case '=': return l === r;
    case '!=': return l !== r;
    case '<': return l < r;
    case '>': return l > r;
    case '<=': return l <= r;
    case '>=': return l >= r;
    default: return false;
  }
}

const STRFTIME_MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STRFTIME_MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STRFTIME_DAYS_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STRFTIME_DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Format a Date with a Splunk strftime string. Uses the browser's local timezone
 * (a documented browser-tool divergence — real Splunk uses the configured/indexer
 * TZ). Covers the common token set rather than the full strptime grammar.
 */
function simpleStrftime(date: Date, format: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const h24 = date.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const startOfYear = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86_400_000);
  const tokens: Record<string, string> = {
    '%Y': String(date.getFullYear()),
    '%y': pad(date.getFullYear() % 100),
    '%m': pad(date.getMonth() + 1),
    '%d': pad(date.getDate()),
    '%e': String(date.getDate()).padStart(2, ' '),
    '%H': pad(h24),
    '%I': pad(h12),
    '%M': pad(date.getMinutes()),
    '%S': pad(date.getSeconds()),
    '%p': h24 < 12 ? 'AM' : 'PM',
    '%b': STRFTIME_MONTHS_ABBR[date.getMonth()],
    '%B': STRFTIME_MONTHS_FULL[date.getMonth()],
    '%a': STRFTIME_DAYS_ABBR[date.getDay()],
    '%A': STRFTIME_DAYS_FULL[date.getDay()],
    '%j': pad(dayOfYear, 3),
    '%s': String(Math.floor(date.getTime() / 1000)),
    '%3N': pad(date.getMilliseconds(), 3),
    '%6N': pad(date.getMilliseconds(), 3) + '000',
    '%T': `${pad(h24)}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    '%F': `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    '%%': '%',
  };
  return format.replace(/%(?:3N|6N|[YymdeHIMSpbBaAjsTF%])/g, (m) => tokens[m] ?? m);
}

/** Parse an eval expression into an AST. Throws on a syntax error. */
function parseExpression(expr: string): Node {
  const tokens = tokenize(expr);
  const parser = new Parser(tokens);
  return parser.parse();
}

export function evaluateExpression(
  expr: string,
  event: SplunkEvent,
  onStubWarning?: (fn: string) => void,
): EvalValue {
  return evalNode(parseExpression(expr), { event, onStubWarning });
}
