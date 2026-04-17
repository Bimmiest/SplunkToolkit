import type { SplunkEvent, ConfDirective, ValidationDiagnostic } from '../types';
import { safeRegex } from '../../utils/splunkRegex';

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

  return events.map((event) => {
    // Eval expressions run in parallel — compute all before applying
    const results = new Map<string, EvalValue>();

    for (const dir of evalDirectives) {
      const fieldName = dir.className ?? '';
      if (!fieldName) continue;
      try {
        const value = evaluateExpression(dir.value.trim(), event, (fn) => {
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
        });
        results.set(fieldName, value);
      } catch (err) {
        const msg = `EVAL-${fieldName}: ${err instanceof Error ? err.message : String(err)}`;
        if (diagnostics && !reportedErrors.has(fieldName)) {
          reportedErrors.add(fieldName);
          diagnostics.push({
            level: 'error',
            message: msg,
            file: 'props.conf',
            line: dir.line,
            directiveKey: dir.key,
          });
        }
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

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(expr[i])) {
      let ident = '';
      while (i < expr.length && /[\w.]/.test(expr[i])) {
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

// ── Parser ──────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;
  private depth = 0;
  private static readonly MAX_DEPTH = 50;
  private event: SplunkEvent;
  private onStubWarning: ((fn: string) => void) | undefined;

  constructor(tokens: Token[], event: SplunkEvent, onStubWarning?: (fn: string) => void) {
    this.tokens = tokens;
    this.event = event;
    this.onStubWarning = onStubWarning;
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

  parse(): EvalValue {
    const result = this.parseOr();
    return result;
  }

  private parseOr(): EvalValue {
    if (++this.depth > Parser.MAX_DEPTH) {
      throw new Error('Expression nesting depth limit exceeded (max 50)');
    }
    try {
      let left = this.parseAnd();
      while (this.peek()?.value === 'OR' || this.peek()?.value === '||') {
        this.consume();
        const right = this.parseAnd();
        left = toBool(left) || toBool(right);
      }
      return left;
    } finally {
      this.depth--;
    }
  }

  private parseAnd(): EvalValue {
    let left = this.parseNot();
    while (this.peek()?.value === 'AND' || this.peek()?.value === '&&') {
      this.consume();
      const right = this.parseNot();
      left = toBool(left) && toBool(right);
    }
    return left;
  }

  private parseNot(): EvalValue {
    if (this.peek()?.value === 'NOT' || this.peek()?.value === '!') {
      this.consume();
      return !toBool(this.parseComparison());
    }
    return this.parseComparison();
  }

  private parseComparison(): EvalValue {
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
      return compare(left, right, op);
    }
    return left;
  }

  private parseInList(left: EvalValue, negate: boolean): EvalValue {
    this.expect('paren', '(');
    const list: EvalValue[] = [];
    if (this.peek()?.type !== 'paren' || this.peek()?.value !== ')') {
      list.push(this.parseOr());
      while (this.peek()?.type === 'comma') {
        this.consume();
        list.push(this.parseOr());
      }
    }
    this.expect('paren', ')');
    const match = list.some((v) => compare(left, v, '='));
    return negate ? !match : match;
  }

  private parseConcat(): EvalValue {
    let left = this.parseAddSub();
    while (this.peek()?.type === 'dot') {
      this.consume();
      const right = this.parseAddSub();
      left = toStr(left) + toStr(right);
    }
    return left;
  }

  private parseAddSub(): EvalValue {
    let left = this.parseMulDiv();
    while (this.peek()?.type === 'op' && (this.peek()?.value === '+' || this.peek()?.value === '-')) {
      const op = this.consume().value;
      const right = this.parseMulDiv();
      if (op === '+') left = toNum(left) + toNum(right);
      else left = toNum(left) - toNum(right);
    }
    return left;
  }

  private parseMulDiv(): EvalValue {
    let left = this.parseUnary();
    while (this.peek()?.type === 'op' && ['*', '/', '%'].includes(this.peek()!.value)) {
      const op = this.consume().value;
      const right = this.parseUnary();
      if (op === '*') left = toNum(left) * toNum(right);
      else if (op === '/') left = toNum(right) !== 0 ? toNum(left) / toNum(right) : null;
      else left = toNum(right) !== 0 ? toNum(left) % toNum(right) : null;
    }
    return left;
  }

  private parseUnary(): EvalValue {
    if (this.peek()?.type === 'op' && this.peek()?.value === '-') {
      this.consume();
      return -toNum(this.parsePrimary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): EvalValue {
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
      return this.consume().value;
    }

    // Single-quoted field reference
    if (tok.type === 'field_ref') {
      return this.getField(this.consume().value);
    }

    // Number literal
    if (tok.type === 'number') {
      return parseFloat(this.consume().value);
    }

    // Function call or field reference
    if (tok.type === 'ident') {
      const name = this.consume().value;

      // Check for function call
      if (this.peek()?.type === 'paren' && this.peek()?.value === '(') {
        this.consume(); // (
        const args: EvalValue[] = [];
        if (this.peek()?.type !== 'paren' || this.peek()?.value !== ')') {
          args.push(this.parseOr());
          while (this.peek()?.type === 'comma') {
            this.consume();
            args.push(this.parseOr());
          }
        }
        this.expect('paren', ')');
        return this.callFunction(name, args);
      }

      // Boolean literals
      if (name === 'true') return true;
      if (name === 'false') return false;

      // Field reference
      return this.getField(name);
    }

    throw new Error(`Unexpected token: ${tok.value}`);
  }

  private getField(name: string): EvalValue {
    if (name === '_raw') return this.event._raw;
    if (name === '_time') return this.event._time ? this.event._time.getTime() / 1000 : null;
    const val = this.event.fields[name];
    if (val === undefined) return null;
    if (Array.isArray(val)) return val;
    return val;
  }

  private callFunction(name: string, args: EvalValue[]): EvalValue {
    const fn = name.toLowerCase();
    switch (fn) {
      // Conditional
      case 'if': return toBool(args[0]) ? args[1] : (args[2] ?? null);
      case 'case': {
        for (let i = 0; i < args.length - 1; i += 2) {
          if (toBool(args[i])) return args[i + 1];
        }
        return null;
      }
      case 'coalesce': return args.find((a) => a !== null && a !== undefined) ?? null;
      case 'nullif': return toStr(args[0]) === toStr(args[1]) ? null : args[0];
      case 'validate': {
        for (let i = 0; i < args.length - 1; i += 2) {
          if (!toBool(args[i])) return args[i + 1];
        }
        return null;
      }

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
          if (format === 'commas') return val.toLocaleString();
          if (format === 'duration') {
            const h = Math.floor(val / 3600);
            const m = Math.floor((val % 3600) / 60);
            const s = Math.floor(val % 60);
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          }
        }
        return toStr(args[0]);
      }
      case 'typeof': {
        if (args[0] === null) return 'Null';
        if (typeof args[0] === 'number') return 'Number';
        if (typeof args[0] === 'boolean') return 'Boolean';
        if (Array.isArray(args[0])) return 'MultiValue';
        return 'String';
      }
      case 'isnull': return args[0] === null || args[0] === undefined;
      case 'isnotnull': return args[0] !== null && args[0] !== undefined;
      case 'isint': { const n = toNum(args[0]); return !isNaN(n) && Number.isInteger(n); }
      case 'isnum': return !isNaN(toNum(args[0]));

      // Math
      case 'abs': return Math.abs(toNum(args[0]));
      case 'ceiling': case 'ceil': return Math.ceil(toNum(args[0]));
      case 'floor': return Math.floor(toNum(args[0]));
      case 'round': {
        const val = toNum(args[0]);
        const decimals = args[1] !== undefined ? toNum(args[1]) : 0;
        const factor = Math.pow(10, decimals);
        return Math.round(val * factor) / factor;
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
      case 'min': return Math.min(...args.map(toNum));
      case 'max': return Math.max(...args.map(toNum));
      case 'random': return Math.random();
      case 'sigfig': return toNum(args[0]);

      // Multivalue
      case 'mvcount': return toMv(args[0]).length;
      case 'mvindex': {
        const mv = toMv(args[0]);
        const start = toNum(args[1]);
        const end = args[2] !== undefined ? toNum(args[2]) : start;
        if (start === end) return mv[start] ?? null;
        return mv.slice(start, end + 1);
      }
      case 'mvfilter':
        this.onStubWarning?.('mvfilter');
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
      case 'md5':   this.onStubWarning?.('md5');    return '[md5() not simulated]';
      case 'sha1':  this.onStubWarning?.('sha1');   return '[sha1() not simulated]';
      case 'sha256': this.onStubWarning?.('sha256'); return '[sha256() not simulated]';
      case 'sha512': this.onStubWarning?.('sha512'); return '[sha512() not simulated]';

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
        this.onStubWarning?.('strptime');
        return toStr(args[0]);
      case 'relative_time':
        this.onStubWarning?.('relative_time');
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
        const regex = safeRegex(`^${pattern}$`, 'i');
        return regex ? regex.test(value) : false;
      }
      case 'match': {
        const regex = safeRegex(toStr(args[1]));
        return regex ? regex.test(toStr(args[0])) : false;
      }
      case 'cidrmatch':
        this.onStubWarning?.('cidrmatch');
        return false;
      case 'searchmatch':
        this.onStubWarning?.('searchmatch');
        return false;

      default:
        return null;
    }
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

function toMv(v: EvalValue): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v === null || v === undefined) return [];
  return [String(v)];
}

function isNumericString(v: EvalValue): boolean {
  if (typeof v !== 'string' || v === '') return false;
  return !isNaN(Number(v));
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

function simpleStrftime(date: Date, format: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return format
    .replace(/%Y/g, String(date.getFullYear()))
    .replace(/%m/g, pad(date.getMonth() + 1))
    .replace(/%d/g, pad(date.getDate()))
    .replace(/%H/g, pad(date.getHours()))
    .replace(/%M/g, pad(date.getMinutes()))
    .replace(/%S/g, pad(date.getSeconds()))
    .replace(/%T/g, `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`)
    .replace(/%F/g, `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
}

export function evaluateExpression(
  expr: string,
  event: SplunkEvent,
  onStubWarning?: (fn: string) => void,
): EvalValue {
  const tokens = tokenize(expr);
  const parser = new Parser(tokens, event, onStubWarning);
  return parser.parse();
}
