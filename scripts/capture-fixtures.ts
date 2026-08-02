// ---------------------------------------------------------------------------
// capture-fixtures.ts
// Captures ground truth for the fidelity corpus from a real Splunk instance and
// writes it to src/engine/__tests__/fixtures/splunk-<version>/.
//
// This is a human-run step, not a CI step. CI asserts against the committed
// JSON and never talks to Splunk. See scripts/capture-fixtures.md.
//
//   node scripts/capture-fixtures.ts [--only <case-id>] [--dry-run]
//
// Connection details come from the environment and have no defaults, so no
// instance is identifiable from this repository.
// ---------------------------------------------------------------------------

import { request as httpsRequest } from 'node:https';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS, type FixtureCase } from '../src/engine/__tests__/fixtures/corpus.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, '..', 'src', 'engine', '__tests__', 'fixtures');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MGMT_URL = process.env.SPLUNK_MGMT_URL;
const TOKEN = process.env.SPLUNK_TOKEN;
const INDEX = process.env.SPLUNK_INDEX ?? 'fixtures';
const APP = process.env.SPLUNK_APP ?? 'splunk_toolkit_fixture_capture';
const CA_CERT = process.env.SPLUNK_CA_CERT;
const INSECURE = process.env.SPLUNK_INSECURE === '1';

if (!MGMT_URL || !TOKEN) {
  console.error(
    'SPLUNK_MGMT_URL and SPLUNK_TOKEN are required.\n\n' +
      '  export SPLUNK_MGMT_URL=https://splunk.example.internal:8089\n' +
      '  export SPLUNK_TOKEN=<splunk auth token>\n\n' +
      'See scripts/capture-fixtures.md for provisioning the account and index.'
  );
  process.exit(2);
}
if (!CA_CERT && !INSECURE) {
  console.error(
    'Refusing to skip TLS verification implicitly.\n' +
      'Set SPLUNK_CA_CERT=/path/to/ca.pem, or SPLUNK_INSECURE=1 to accept a self-signed certificate.'
  );
  process.exit(2);
}

const CA = CA_CERT ? readFileSync(CA_CERT) : undefined;
const BASE = MGMT_URL.replace(/\/+$/, '');

// Constant ingest metadata. Pinned to literals so the captured events carry
// nothing about the instance they came from, even before the field denylist.
const DEFAULT_INGEST_HOST = 'fixture-capture';
const DEFAULT_INGEST_SOURCE = 'fixture-capture';

// Every search is scoped to events indexed by *this* invocation. Without that,
// re-ingesting a sourcetype (which --reuse-config does by design, and any
// re-run does by accident) returns this attempt's events and every previous
// attempt's, and the fixture silently records each event several times. The
// capture account is not guaranteed `can_delete`, so scoping the read is the
// only reliable answer -- the index cannot be wiped.
//
// This deliberately uses `_index_earliest` rather than a marker in `host` or
// `source`: both of those are addressable by props stanzas (`[host::...]`,
// `[source::...]`) and so must stay under the corpus's control for the
// stanza-precedence cases. `_index_earliest` filters on indexing time, which
// no stanza can match on.
const CAPTURE_START = Math.floor(Date.now() / 1000) - 1;

// A per-run token in every sourcetype. The capture account is not guaranteed
// `can_delete`, so the index cannot be wiped between runs; scoping sourcetypes
// per run means a search can never match a previous run's events.
const RUN_ID = process.env.SPLUNK_RUN_ID ?? String(Date.now()).slice(-8);

const onlyCase = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const DRY_RUN = process.argv.includes('--dry-run');
// Index-time config only takes effect after a restart, so skipping it produces
// results captured against the *previous* config. Strictly an iteration aid.
const SKIP_RESTART = process.argv.includes('--skip-restart');
// Write and reload the stanzas, then stop before ingesting. Used to stage
// config for a later --reuse-config run, and to test whether a reload alone is
// enough for index-time settings without committing to a restart.
const CONFIG_ONLY = process.argv.includes('--config-only');
// Ingest and search against config a previous run already wrote and splunkd has
// already loaded, identified by SPLUNK_RUN_ID. Implies --skip-restart.
//
// This exists because rewriting the stanzas is not free: deleting and
// recreating them may unload the sourcetype from the running parsing pipeline
// without reloading it, in which case ingest silently falls back to defaults
// and records confident, wrong ground truth. Reusing loaded config avoids the
// question entirely.
const REUSE_CONFIG = process.argv.includes('--reuse-config');
if (REUSE_CONFIG && !process.env.SPLUNK_RUN_ID) {
  console.error('--reuse-config requires SPLUNK_RUN_ID matching the run whose stanzas are loaded.');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Fields excluded from every fixture.
//
// Two reasons, both disqualifying on their own: the value differs per capture
// (so the fixture would never reproduce), or it identifies the instance.
// `date_*`, `punct`, `linecount` and the position fields are Splunk-generated
// metadata the engine does not model -- excluded deliberately, and noted in the
// manifest so the omission stays visible rather than looking like coverage.
// ---------------------------------------------------------------------------

const EXCLUDED_FIELDS = new Set([
  '_bkt', '_cd', '_indextime', '_serial', '_si', '_sourcetype', '_subsecond',
  '_kv', '_confstr', '_eventtype_color', '_time', '_raw',
  'splunk_server', 'splunk_server_group', 'index', 'host', 'source', 'sourcetype',
  'eventtype', 'tag', 'punct', 'linecount', 'timestartpos', 'timeendpos',
  // Splunk's own annotation of how timestamping went ("none" when it could not
  // parse one). Generated metadata, not an extracted field, and not modelled.
  'timestamp',
  'epochCapture',
]);

const EXCLUDED_PREFIXES = ['date_', 'tag::'];

function isRecordedField(name: string): boolean {
  if (EXCLUDED_FIELDS.has(name)) return false;
  return !EXCLUDED_PREFIXES.some((p) => name.startsWith(p));
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface Res {
  status: number;
  body: string;
}

type ReqOpts = { form?: Record<string, string>; body?: string; query?: Record<string, string> };

/**
 * Retries connection-level failures only. An HTTP error is a real answer and is
 * returned to the caller; a refused connection during the settling period after
 * a restart is not, and retrying it is the difference between a capture run
 * that completes and one that dies halfway through.
 */
async function req(method: string, path: string, opts: ReqOpts = {}, attempts = 4): Promise<Res> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await reqOnce(method, path, opts);
    } catch (err) {
      lastErr = err;
      await sleep(2000 * (i + 1));
    }
  }
  throw lastErr;
}

function reqOnce(method: string, path: string, opts: ReqOpts = {}): Promise<Res> {
  const url = new URL(path.startsWith('http') ? path : BASE + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  let payload: string | undefined;
  const headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` };

  if (opts.form) {
    payload = new URLSearchParams(opts.form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (opts.body !== undefined) {
    payload = opts.body;
    headers['Content-Type'] = 'text/plain';
  }
  if (payload !== undefined) headers['Content-Length'] = String(Buffer.byteLength(payload));

  return new Promise((resolve, reject) => {
    const r = httpsRequest(
      { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers, ca: CA, rejectUnauthorized: !INSECURE, timeout: 120_000 },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf }));
      }
    );
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error(`timeout: ${method} ${url.pathname}`)));
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}

function expectOk(res: Res, what: string, allow: number[] = []): Res {
  if (res.status >= 200 && res.status < 300) return res;
  if (allow.includes(res.status)) return res;
  throw new Error(`${what} failed: HTTP ${res.status}\n${res.body.slice(0, 600)}`);
}

// ---------------------------------------------------------------------------
// Typed boundaries for splunkd's JSON.
//
// `JSON.parse` returns `any`, which spreads untyped values through everything
// downstream. These are the only assertions in the file; past them, values are
// read through `str`/`num` so a shape change surfaces as an empty value at the
// boundary rather than as `[object Object]` in a committed fixture.
// ---------------------------------------------------------------------------

interface SplunkEntry {
  name: string;
  content: Record<string, unknown>;
}

function asCollection(body: string): { entry?: SplunkEntry[] } {
  return JSON.parse(body) as { entry?: SplunkEntry[] };
}

function asExportLine(line: string): { result?: Record<string, unknown> } {
  return JSON.parse(line) as { result?: Record<string, unknown> };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Splunk operations
// ---------------------------------------------------------------------------

async function serverInfo(): Promise<{ version: string; build: string }> {
  const res = expectOk(
    await req('GET', '/services/server/info', { query: { output_mode: 'json' } }),
    'server/info'
  );
  const c = asCollection(res.body).entry?.[0]?.content ?? {};
  // Deliberately narrow: `serverName`, `host`, `guid` and `licenseKeys` are all
  // present on this payload and all identify the instance.
  return { version: str(c.version), build: str(c.build) };
}

/** splunkd's process start time, or null while it is down. */
async function startupTime(): Promise<number | null> {
  try {
    // attempts=1: the caller polls, and a refused connection here is the signal
    // being measured, not a failure to retry through.
    const res = await req('GET', '/services/server/info', { query: { output_mode: 'json' } }, 1);
    if (res.status !== 200) return null;
    return Number(str(asCollection(res.body).entry?.[0]?.content.startup_time));
  } catch {
    return null; // connection refused while restarting
  }
}

async function ensureApp(): Promise<void> {
  expectOk(
    await req('POST', '/services/apps/local', { form: { name: APP, visible: '0' } }),
    'create app',
    [409]
  );
}

async function clearStanzas(conf: 'props' | 'transforms'): Promise<void> {
  const res = await req('GET', `/servicesNS/nobody/${APP}/configs/conf-${conf}`, {
    query: { output_mode: 'json', count: '0' },
  });
  if (res.status !== 200) return; // conf file not created yet
  for (const entry of asCollection(res.body).entry ?? []) {
    const name = entry.name;
    // Ours are either `fx_...` or an addressed form whose pattern carries an
    // `fx_` marker — which includes wildcarded ones like `source::...fx_a...`,
    // where the marker does not directly follow the `::`. Requiring `::fx_`
    // exactly missed those, and the leftovers made every later run fail with
    // "already exists". Never touch anything else in the app.
    if (!name.startsWith('fx_') && !(name.includes('::') && name.includes('fx_'))) continue;
    await req('DELETE', `/servicesNS/nobody/${APP}/configs/conf-${conf}/${encodeURIComponent(name)}`);
  }
}

function parseConfBody(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('[')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    out.push([t.slice(0, eq).trim(), t.slice(eq + 1).trim()]);
  }
  return out;
}

async function writeStanza(conf: 'props' | 'transforms', stanza: string, body: string): Promise<void> {
  const pairs = parseConfBody(body);
  const form: Record<string, string> = { name: stanza };
  for (const [k, v] of pairs) form[k] = v;
  expectOk(
    await req('POST', `/servicesNS/nobody/${APP}/configs/conf-${conf}`, { form }),
    `create ${conf} [${stanza}]`
  );
  // Search-time extractions are only found if the stanza is globally shared;
  // REST-created objects default to private to the creating user.
  expectOk(
    await req('POST', `/servicesNS/nobody/${APP}/configs/conf-${conf}/${encodeURIComponent(stanza)}/acl`, {
      form: { sharing: 'global', owner: 'nobody', 'perms.read': '*' },
    }),
    `share ${conf} [${stanza}]`,
    [403]
  );
}

/** Split a transforms.conf text into its stanzas. */
function splitTransforms(text: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  let current: { name: string; body: string } | null = null;
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^\[(.+)\]$/);
    if (m) {
      if (current) out.push(current);
      current = { name: m[1] ?? '', body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Ask splunkd to re-read the conf files. Cheap and safe to attempt; whether it
 * is *sufficient* for index-time settings is the open question -- the parsing
 * pipeline consults them at ingest, and the documented guidance is that a
 * restart is required. It may still suffice for a sourcetype splunkd has never
 * seen, which is every sourcetype this script creates.
 */
async function reloadConf(): Promise<void> {
  for (const conf of ['props', 'transforms']) {
    await req('POST', `/servicesNS/nobody/${APP}/admin/conf-${conf}/_reload`);
  }
}

async function restartAndWait(): Promise<void> {
  // splunkd keeps answering /server/info for several seconds after accepting
  // the restart, so "responds to a ping" is not a readiness signal -- polling
  // for it returns immediately, against a server that is about to go down.
  // `startup_time` changing is unambiguous.
  const before = await startupTime();
  expectOk(await req('POST', '/services/server/control/restart'), 'restart', [200, 202]);

  process.stdout.write('  restarting');
  for (let i = 0; i < 120; i++) {
    await sleep(2000);
    process.stdout.write('.');
    const now = await startupTime();
    if (now !== null && (before === null || now > before)) {
      // splunkd answers REST before the search peers are ready.
      await sleep(8000);
      process.stdout.write(' up\n');
      return;
    }
  }
  throw new Error('splunkd did not come back within 4 minutes');
}

async function ingest(
  sourcetype: string,
  data: string,
  host = DEFAULT_INGEST_HOST,
  source = DEFAULT_INGEST_SOURCE
): Promise<void> {
  expectOk(
    await req('POST', '/services/receivers/stream', {
      query: { index: INDEX, sourcetype, host, source },
      body: data,
    }),
    `ingest ${sourcetype}`,
    [204]
  );
}

interface CapturedEvent {
  _raw: string;
  _time: number | null;
  fields: Record<string, string | string[]>;
}

/**
 * `_cd` is "<bucket>:<offset>"; both ascend with ingest order, which `_time`
 * does not when timestamps repeat or fail to parse entirely. It is present on
 * every returned result but is NOT readable by `eval` -- `eval x = _cd` yields
 * null, and a subsequent `sort` on that null drops every event, returning an
 * empty result set rather than an error. So order here, on the parsed values,
 * rather than in SPL.
 */
function byIngestOrder(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const parse = (v: unknown): [number, number] => {
    const [bucket, offset] = str(v).split(':');
    return [Number(bucket) || 0, Number(offset) || 0];
  };
  const [ab, ao] = parse(a._cd);
  const [bb, bo] = parse(b._cd);
  return ab === bb ? ao - bo : ab - bb;
}

/** Event count for this attempt's ingest, used to confirm indexing has settled. */
async function countFor(sourcetype: string): Promise<number> {
  const res = expectOk(
    await req('POST', '/services/search/jobs/export', {
      form: {
        search: `search index=${INDEX} sourcetype=${sourcetype} _index_earliest=${CAPTURE_START} | stats count`,
        output_mode: 'json',
        earliest_time: '0',
        latest_time: '+10y',
      },
    }),
    `count ${sourcetype}`
  );
  for (const line of res.body.split('\n')) {
    if (!line.trim()) continue;
    const r = asExportLine(line).result;
    if (r?.count !== undefined) return Number(str(r.count));
  }
  return 0;
}

async function search(sourcetype: string, expected: number): Promise<CapturedEvent[]> {
  // Two non-obvious requirements, both of which fail silently rather than error:
  //
  // `epochCapture` must NOT begin with an underscore. Splunk treats leading-
  // underscore fields as internal and strips them from results, so an `__epoch`
  // eval yields a fixture where every `_time` is null.
  //
  // `| fields *` is required. The export endpoint omits search-time-discovered
  // fields from the payload unless the search references them, so without it
  // every fixture records an empty field set while extraction is working fine.
  const spl =
    `search index=${INDEX} sourcetype=${sourcetype} _index_earliest=${CAPTURE_START} ` +
    `| eval epochCapture = _time | fields *`;

  for (let attempt = 0; attempt < 20; attempt++) {
    const res = expectOk(
      await req('POST', '/services/search/jobs/export', {
        form: {
          search: spl,
          output_mode: 'json',
          // Verified against Splunk 10.4.0, which is fussy here in ways the
          // docs do not cover: `earliest_time` accepts bare epoch `0`, but
          // `latest_time` rejects any bare epoch with "latest_time must be
          // after earliest_time", and ISO-8601 is rejected outright on both.
          // A relative modifier is the form that works. The +10y upper bound
          // keeps future-dated fixtures in range, since an omitted
          // `latest_time` means "now" and would silently drop them.
          earliest_time: '0',
          latest_time: '+10y',
          adhoc_search_level: 'verbose',
        },
      }),
      `search ${sourcetype}`
    );

    const rows: Array<Record<string, unknown>> = [];
    for (const line of res.body.split('\n')) {
      if (!line.trim()) continue;
      const r = asExportLine(line).result;
      if (r) rows.push(r);
    }
    rows.sort(byIngestOrder);

    const events: CapturedEvent[] = rows.map((r) => {
      const fields: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(r)) {
        if (!isRecordedField(k)) continue;
        fields[k] = v as string | string[];
      }
      const epoch = r.epochCapture ? Number(str(r.epochCapture)) : NaN;
      return {
        _raw: str(r._raw),
        _time: Number.isFinite(epoch) ? Math.round(epoch * 1000) : null,
        fields,
      };
    });

    // Indexing is asynchronous, so a first non-empty result may still be
    // partial. Require the count to hold steady across two polls rather than
    // recording a half-ingested event set as ground truth.
    if (events.length >= expected) {
      await sleep(1500);
      const confirm = await countFor(sourcetype);
      if (confirm === events.length) return events;
    }
    await sleep(1500);
  }
  throw new Error(`no stable result for ${sourcetype} after 30s -- check the index and the stanza`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const cases: FixtureCase[] = onlyCase ? CORPUS.filter((c) => c.id === onlyCase) : CORPUS;
if (cases.length === 0) {
  console.error(`No case matches --only ${onlyCase}`);
  process.exit(2);
}

const seen = new Set<string>();
for (const c of cases) {
  if (seen.has(c.id)) throw new Error(`duplicate case id: ${c.id}`);
  seen.add(c.id);
}

const info = await serverInfo();
console.log(`Splunk ${info.version} (build ${info.build})`);
console.log(`${cases.length} case(s), run ${RUN_ID}, index ${INDEX}, app ${APP}\n`);

if (DRY_RUN) {
  for (const c of cases) console.log(`  would capture ${c.id} (${c.phase})`);
  process.exit(0);
}

const stanzaFor = (c: FixtureCase) => `fx_${RUN_ID}_${c.id.replace(/-/g, '_')}`;

if (REUSE_CONFIG) {
  console.log(`reusing config already loaded for run ${RUN_ID}`);
} else {
  await ensureApp();
  await clearStanzas('props');
  await clearStanzas('transforms');

  console.log('writing config...');
  for (const c of cases) {
    await writeStanza('props', stanzaFor(c), c.props);
    for (const extra of c.extraProps ?? []) {
      await writeStanza('props', extra.stanza, extra.body);
    }
    for (const t of splitTransforms(c.transforms ?? '')) {
      await writeStanza('transforms', t.name, t.body);
    }
  }
  await reloadConf();
}

if (CONFIG_ONLY) {
  console.log(`config written and reloaded for run ${RUN_ID}; exiting before ingest`);
  process.exit(0);
}

// Index-time settings are consulted by the parsing pipeline at ingest, so they
// only take effect after a restart. Search-time-only runs skip it.
if (REUSE_CONFIG || SKIP_RESTART) {
  if (!REUSE_CONFIG) console.warn('--skip-restart: index-time results will reflect the PREVIOUS config');
} else if (cases.some((c) => c.phase === 'index-time')) {
  console.log('index-time cases present, restarting splunkd...');
  await restartAndWait();
} else {
  console.log('search-time cases only, no restart needed');
}

const outDir = join(FIXTURE_ROOT, `splunk-${info.version}`);
mkdirSync(outDir, { recursive: true });

console.log('\ncapturing...');
const captured: Array<{ id: string; events: number }> = [];
for (const c of cases) {
  const st = stanzaFor(c);
  await ingest(st, c.input, c.ingestHost, c.ingestSource);
  const events = await search(st, 1);
  const fixture = {
    id: c.id,
    splunk: info,
    capturedAt: new Date().toISOString(),
    directives: c.directives,
    phase: c.phase,
    props: c.props,
    ...(c.transforms ? { transforms: c.transforms } : {}),
    ...(c.extraProps ? { extraProps: c.extraProps } : {}),
    ingestHost: c.ingestHost ?? DEFAULT_INGEST_HOST,
    ingestSource: c.ingestSource ?? DEFAULT_INGEST_SOURCE,
    input: c.input,
    events,
  };
  writeFileSync(join(outDir, `${c.id}.json`), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`  ${c.id}: ${events.length} event(s)`);
  captured.push({ id: c.id, events: events.length });
}

// A full run owns the manifest; a --only run must not shrink it.
const manifestPath = join(outDir, 'manifest.json');
if (!onlyCase || !existsSync(manifestPath)) {
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        splunk: info,
        capturedAt: new Date().toISOString(),
        cases: captured.map((c) => c.id).sort(),
        excludedFields: {
          note:
            'Fields omitted from every fixture: non-deterministic per capture, ' +
            'instance-identifying, or Splunk-generated metadata the engine does not model.',
          names: [...EXCLUDED_FIELDS].filter((f) => f !== '_time' && f !== '_raw').sort(),
          prefixes: EXCLUDED_PREFIXES,
        },
      },
      null,
      2
    ) + '\n'
  );
}

console.log(`\nwrote ${captured.length} fixture(s) to ${outDir.replace(FIXTURE_ROOT, 'src/engine/__tests__/fixtures')}`);
