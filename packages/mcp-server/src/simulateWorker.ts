/**
 * Sandbox worker entry point. The parent holds a wall-clock budget and calls
 * `worker.terminate()` when it expires — hard termination is the mechanism
 * that makes running conf-derived regexes safe (docs/engine.md), and it only
 * works because the regexes execute HERE, on a thread the parent can kill,
 * never on the server's own thread.
 *
 * `./v8Flags` must stay the first import: it arms V8's linear-time regex
 * fallback before the engine's modules load.
 */
import './v8Flags';
import { parentPort, workerData } from 'node:worker_threads';
import { runPipeline } from '../../../src/engine/pipeline';
import { parseConf } from '../../../src/engine/parser/confParser';
import { mergeDirectives, resolveStanzasForEvent } from '../../../src/engine/parser/stanzaMatcher';
import type { ConfDirective, ConfStanza, EventMetadata } from '../../../src/engine/types';
import type {
  ExplainDirective,
  ExplainRequest,
  ExplainResponse,
  ExplainStanza,
  SimulateRequest,
  ValidateRequest,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

/**
 * A sourcetype no real conf should match, so a validate run exercises the
 * config-level checks without dragging event-level processing into it.
 */
export const VALIDATE_SOURCETYPE = '__propslab_mcp_validate__';

function handleSimulate(request: SimulateRequest) {
  const { result, diagnostics } = runPipeline(
    request.raw,
    request.metadata,
    request.propsConf,
    request.transformsConf,
    { perEventPipeline: request.perEventPipeline, captureOffsets: request.captureOffsets },
  );
  return { result, diagnostics };
}

/**
 * The config-level diagnostics (parse errors, unknown/mis-cased keys, missing
 * transform references, inert settings, type mismatches, unsimulated-directive
 * boundaries) all live inside `runPipeline` — issue #202 rules out engine
 * changes, so rather than fork that logic, run the pipeline over a one-line
 * dummy sample under a sourcetype nothing matches and keep only the
 * diagnostics that are about the conf text itself.
 */
function handleValidate(request: ValidateRequest) {
  const metadata: EventMetadata = {
    index: 'main',
    host: 'localhost',
    source: '',
    sourcetype: VALIDATE_SOURCETYPE,
  };
  const { diagnostics } = runPipeline(
    'validate\n',
    metadata,
    request.propsConf,
    request.transformsConf,
    { perEventPipeline: false, captureOffsets: false },
  );
  return {
    diagnostics: diagnostics.filter(
      (d) => d.file !== 'raw' && !d.message.includes(VALIDATE_SOURCETYPE),
    ),
  };
}

function toExplainDirective(d: ConfDirective): ExplainDirective {
  return {
    key: d.key,
    value: d.value,
    line: d.line,
    ...(d.layer !== undefined ? { layer: d.layer } : {}),
    ...(d.overrides !== undefined ? { overrides: d.overrides } : {}),
    ...(d.overriddenBy !== undefined ? { overriddenBy: d.overriddenBy } : {}),
  };
}

function toExplainStanza(s: ConfStanza): ExplainStanza {
  return {
    name: s.name,
    type: s.type,
    lineRange: s.lineRange,
    ...(s.layer !== undefined ? { layer: s.layer } : {}),
    ...(s.layers !== undefined ? { layers: s.layers } : {}),
    directives: s.directives.map(toExplainDirective),
  };
}

function handleExplain(request: ExplainRequest): ExplainResponse {
  const parsed = parseConf(request.conf, request.file);
  const response: ExplainResponse = {
    parseErrors: parsed.errors,
    stanzas: parsed.stanzas.map(toExplainStanza),
  };

  if (request.file === 'props.conf' && request.metadata) {
    const resolved = resolveStanzasForEvent(parsed.stanzas, request.metadata);
    const merged = mergeDirectives(resolved.stanzas);
    // mergeDirectives returns the winning ConfDirective objects themselves, so
    // the stanza each winner came from is recoverable by identity.
    const stanzaOf = (directive: ConfDirective): string =>
      resolved.stanzas.find((s) => s.directives.includes(directive))?.name ?? 'default';
    response.resolution = {
      metadata: request.metadata,
      effectiveMetadata: resolved.metadata,
      ...(resolved.assignedSourcetype ? { assignedSourcetype: resolved.assignedSourcetype } : {}),
      matchedStanzas: resolved.stanzas.map((s) => ({
        name: s.name,
        type: s.type,
        ...(s.layer !== undefined ? { layer: s.layer } : {}),
      })),
      effectiveDirectives: merged.map((d) => ({ ...toExplainDirective(d), stanza: stanzaOf(d) })),
    };
  }

  return response;
}

function handle(request: WorkerRequest) {
  switch (request.op) {
    case 'simulate':
      return handleSimulate(request);
    case 'validate':
      return handleValidate(request);
    case 'explain':
      return handleExplain(request);
  }
}

const port = parentPort;
if (port) {
  let response: WorkerResponse;
  try {
    response = { ok: true, data: handle(workerData as WorkerRequest) };
  } catch (err) {
    response = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  port.postMessage(response);
}
