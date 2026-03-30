#!/usr/bin/env node

/**
 * Sapient Oracle MCP Proxy
 *
 * Transparent proxy for the Oracle SQLcl MCP server that:
 * 1. Fixes the `run-sql` tool's invalid JSON Schema (oneOf inside properties)
 * 2. Auto-connects to Oracle on first tool use via ORACLE_CONN env var
 * 3. Passes all tool calls through to the real SQLcl MCP server
 *
 * All original tools (run-sql, run-sqlcl, schema-information, connect,
 * disconnect, list-connections) are preserved with full functionality
 * including async query execution and job management.
 *
 * Env vars:
 *   ORACLE_CONN - Connection string (e.g., user/pass@//host:port/service)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const ORACLE_CONN = process.env.ORACLE_CONN || "";

// ── Connect to the real SQLcl MCP server ──────────────────────────────

let sqlclClient;

try {
  const sqlclTransport = new StdioClientTransport({
    command: "sql",
    args: ["-mcp"],
    // Pass full environment — SQLcl needs JAVA_HOME and other vars
    // that the MCP SDK's default env filtering strips out
    env: { ...process.env },
  });

  sqlclClient = new Client(
    { name: "oracle-proxy", version: "1.0" },
    { capabilities: {} },
  );

  await sqlclClient.connect(sqlclTransport);
  console.error("[oracle-proxy] Connected to SQLcl MCP server");
} catch (err) {
  console.error(`[oracle-proxy] Failed to start SQLcl MCP: ${err.message}`);
  process.exit(1);
}

// ── Auto-connection state ─────────────────────────────────────────────

let autoConnected = false;

async function ensureConnected() {
  if (autoConnected || !ORACLE_CONN) return;

  try {
    const result = await sqlclClient.callTool({
      name: "run-sqlcl",
      arguments: { sqlcl: `connect ${ORACLE_CONN}`, model: "claude" },
    });
    const text = result.content?.[0]?.text ?? "";
    if (text.toLowerCase().includes("connected")) {
      autoConnected = true;
      console.error("[oracle-proxy] Auto-connected to Oracle");
    }
  } catch (err) {
    console.error(`[oracle-proxy] Auto-connect failed: ${err}`);
  }
}

// ── Fix the run-sql schema ────────────────────────────────────────────

/**
 * The SQLcl MCP server's run-sql tool has an invalid schema:
 *   { properties: { oneOf: [...] } }
 *
 * This should be:
 *   { oneOf: [ { properties: {...} }, { properties: {...} } ] }
 *
 * We fix it by rewriting to a flat properties schema that covers
 * both use cases (query execution and job management).
 */
function fixRunSqlSchema(tool) {
  return {
    ...tool,
    inputSchema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description:
            "The SQL query to execute. Required for running queries.",
        },
        async: {
          type: "boolean",
          description:
            "If true, executes the query asynchronously and returns a job ID. Default: false.",
          default: false,
        },
        job_id: {
          type: "string",
          description:
            "Job ID from an async query. Use with 'command' to manage the job.",
        },
        command: {
          type: "string",
          enum: ["status", "results", "cancel"],
          description:
            "Command for async job management: 'status', 'results', or 'cancel'. Requires job_id.",
        },
        model: {
          type: "string",
          description: "The name of the language model being used.",
          default: "claude",
        },
      },
    },
  };
}

// ── Create the proxy server ───────────────────────────────────────────

const server = new Server(
  { name: "sapient-oracle", version: "0.1.0" },
  {
    capabilities: {
      tools: { listChanged: true },
    },
  },
);

// List tools: fetch from SQLcl, fix schemas, return
server.setRequestHandler(
  ListToolsRequestSchema,
  async () => {
    const result = await sqlclClient.listTools();
    const tools = (result.tools ?? []).map((tool) => {
      if (tool.name === "run-sql") {
        return fixRunSqlSchema(tool);
      }
      return tool;
    });
    return { tools };
  },
);

// Call tools: auto-connect, then pass through to SQLcl
server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const { name, arguments: args } = request.params;

    // Auto-connect before any tool use (except connect/disconnect/list-connections)
    if (!["connect", "disconnect", "list-connections"].includes(name)) {
      await ensureConnected();
    }

    // If this is a "connect" call, track the state
    if (name === "connect") {
      autoConnected = false; // reset, let the explicit connect take over
    }

    const result = await sqlclClient.callTool({ name, arguments: args });
    return result;
  },
);

// ── Start ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[oracle-proxy] Proxy server started");
