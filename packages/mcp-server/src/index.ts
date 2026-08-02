/**
 * Launcher. docs/engine.md requires the V8 regex-fallback flags to be set
 * before the first regex they protect is compiled, and the only guaranteed
 * way to do that is on the node command line — so this process re-execs
 * itself with the flags and only then loads the server (and with it the
 * engine). Worker threads inherit process-wide V8 flags, so the sandbox
 * worker is covered by the same re-exec.
 *
 * `PROPSLAB_MCP_NO_REEXEC=1` opts out; `v8Flags.ts`'s setFlagsFromString
 * fallback still applies, best-effort.
 */
import { spawn } from 'node:child_process';
import { flagsAlreadySet, REGEXP_FALLBACK_FLAGS } from './v8Flags';

async function main(): Promise<void> {
  if (!flagsAlreadySet() && process.env.PROPSLAB_MCP_NO_REEXEC !== '1') {
    const child = spawn(
      process.execPath,
      [...REGEXP_FALLBACK_FLAGS, ...process.execArgv, __filename, ...process.argv.slice(2)],
      { stdio: 'inherit' },
    );
    child.on('exit', (code, signal) => {
      process.exit(code ?? (signal ? 1 : 0));
    });
    return;
  }

  const { start } = await import('./server');
  await start();
}

main().catch((err: unknown) => {
  console.error('propslab MCP server failed to start:', err);
  process.exit(1);
});
