/**
 * The MCP server proper: stdio transport, four tools. `index.ts` is the
 * launcher that re-execs node with the V8 regex-fallback flags before this
 * module (and through it, the engine) ever loads — `./v8Flags` stays first as
 * the fallback for embedders that skip the launcher.
 */
import './v8Flags';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools';

export function createServer(): McpServer {
  const server = new McpServer({ name: 'propslab', version: '0.1.0' });
  registerTools(server);
  return server;
}

export async function start(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // stdout belongs to the protocol; anything human-facing goes to stderr.
  console.error('propslab MCP server listening on stdio');
}
