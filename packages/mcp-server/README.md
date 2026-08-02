# propslab-mcp

An [MCP](https://modelcontextprotocol.io) server over the propslab simulation
engine (`src/engine/**`), so an LLM agent can *simulate* a Splunk config
against real sample data instead of guessing about it — draft a props.conf,
run it, read the per-event `processingTrace`, and fix its own mistake.
Implements [#202](https://github.com/Bimmiest/propslab/issues/202).

## Tools

| Tool | Wraps | Returns |
|---|---|---|
| `simulate` | `runPipeline` | Per-event `_time`, `fields`, indexed fields, and a `processingTrace` naming every processor that touched the event, plus diagnostics |
| `validate` | the pipeline's config-level parse/lint path | `ValidationDiagnostic[]` for conf text alone — no sample needed |
| `explain_precedence` | layered `parseConf` + `resolveStanzasForEvent` + `mergeDirectives` | btool-style provenance: which layer won each attribute (`overrides` / `overriddenBy` / `layers`), and the effective directive set for a sourcetype |
| `lookup_directive` | `directiveRegistry` | Curated directive documentation, including the simulation-support level, so an agent cites the registry instead of recalling spec |

`simulate` and `explain_precedence` accept conf input as either one flat
string or an ordered list of layers, lowest precedence first — an agent
pointed at a real app directory hands over `default/` + `local/` and gets
btool-style provenance back.

## Setup

```bash
cd packages/mcp-server
npm install
npm run build
```

Then register the server with your MCP client. Claude Code:

```bash
claude mcp add propslab -- node /path/to/propslab/packages/mcp-server/dist/index.js
```

Or in any client's JSON config:

```json
{
  "mcpServers": {
    "propslab": {
      "command": "node",
      "args": ["/path/to/propslab/packages/mcp-server/dist/index.js"]
    }
  }
}
```

## Security model

The server executes regexes the agent wrote and the user may not have
reviewed. `docs/engine.md`'s closing section is the spec this implements:

- **Every engine run happens in a worker thread with a wall-clock budget**
  (default 5s, `timeout_ms` per call) and hard `worker.terminate()` on
  expiry. This is the mechanism; nothing else is.
- **`captureOffsets` defaults to `false`** — nothing here renders highlights,
  and the `d` flag it forces onto every `EXTRACT` disqualifies patterns from
  V8's linear-time fallback (measured at 8 ms vs 91 s in `docs/engine.md`).
- **The launcher re-execs node with
  `--enable-experimental-regexp-engine-on-excessive-backtracks`** (plus a
  backtrack threshold) before anything compiles a regex, as the documented
  second layer. Lookaheads and backreferences decline that fallback, which is
  why the watchdog stays the mechanism. `PROPSLAB_MCP_NO_REEXEC=1` opts out.
- **A timeout comes back structured**: budget, every regex-valued directive
  in the conf (file / stanza / key / line / layer), and which of them the
  engine's ReDoS heuristic flags — so the agent can repair the pattern rather
  than retry blind. The heuristic is structural and documents what it cannot
  see (e.g. `(a|aa)+`), and the error text says so.

## Development

```bash
npm run typecheck   # tsc --noEmit over the package + the engine it imports
npm run build       # typecheck + esbuild bundles (dist/index.js, dist/simulateWorker.js)
npm test            # builds, then vitest — the worker tests run the built bundle
```

The engine is imported from `../../src/engine` as-is; this package makes no
engine changes, which is the boundary #202 draws — if one ever seems needed,
that's an issue to file, not a patch to hide here.
