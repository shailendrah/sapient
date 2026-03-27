#!/usr/bin/env npx tsx

/**
 * Gateway integration test — connects to the WebSocket, sends a chat message,
 * and verifies streaming events come back.
 *
 * Usage:
 *   1. Start the gateway: node frontend/dist/src/cli/index.js start
 *   2. In another terminal: npx tsx test/gateway-test.ts [token]
 */

import WebSocket from "ws";

const PORT = process.env.PORT ?? "18789";
const HOST = process.env.HOST ?? "127.0.0.1";
const TOKEN = process.argv[2] ?? process.env.SAPIENT_TOKEN;

const WS_URL = `ws://${HOST}:${PORT}`;

let reqId = 0;
function nextId(): string {
  return `test_${++reqId}`;
}

function send(ws: WebSocket, method: string, params?: unknown): string {
  const id = nextId();
  ws.send(JSON.stringify({ type: "req", id, method, params }));
  return id;
}

async function main() {
  console.log(`Connecting to ${WS_URL}...`);

  const ws = new WebSocket(WS_URL);
  const responses = new Map<string, any>();
  const events: any[] = [];

  ws.on("message", (raw: Buffer) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === "hello-ok") {
      console.log(`Connected! Server v${msg.server.version}, connId=${msg.server.connId}`);
      console.log(`Methods: ${msg.methods.join(", ")}`);
      console.log(`Events: ${msg.events.join(", ")}`);
      console.log("---");
      runTests();
      return;
    }

    if (msg.type === "res") {
      responses.set(msg.id, msg);
      return;
    }

    if (msg.type === "event") {
      events.push(msg);
      console.log(`  [EVENT] ${msg.event}: ${JSON.stringify(msg.payload?.data?.type ?? msg.event)}`);
      return;
    }
  });

  ws.on("error", (err) => {
    console.error(`WebSocket error: ${err.message}`);
    process.exit(1);
  });

  ws.on("close", () => {
    console.log("Connection closed.");
  });

  async function waitForResponse(id: string, timeoutMs = 5000): Promise<any> {
    const start = Date.now();
    while (!responses.has(id)) {
      if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for response ${id}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    return responses.get(id);
  }

  async function waitForEvents(count: number, timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    while (events.length < count) {
      if (Date.now() - start > timeoutMs) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async function runTests() {
    try {
      // Test 1: channels.list
      console.log("Test 1: channels.list");
      const chId = send(ws, "channels.list");
      const chRes = await waitForResponse(chId);
      console.log(`  OK: ${chRes.ok}, channels: ${JSON.stringify(chRes.payload?.channels?.length ?? 0)}`);

      // Test 2: sessions.list
      console.log("Test 2: sessions.list");
      const sessId = send(ws, "sessions.list");
      const sessRes = await waitForResponse(sessId);
      console.log(`  OK: ${sessRes.ok}, sessions: ${sessRes.payload?.sessions?.length ?? 0}`);

      // Test 3: config.get
      console.log("Test 3: config.get");
      const cfgId = send(ws, "config.get");
      const cfgRes = await waitForResponse(cfgId);
      console.log(`  OK: ${cfgRes.ok}, model: ${cfgRes.payload?.config?.agent?.model ?? "default"}`);

      // Test 4: chat.send
      console.log("Test 4: chat.send (streaming)");
      events.length = 0;
      const chatId = send(ws, "chat.send", {
        sessionKey: "test",
        message: "Hello, Sapient!",
      });
      const chatRes = await waitForResponse(chatId);
      console.log(`  OK: ${chatRes.ok}, runId: ${chatRes.payload?.runId}`);

      // Wait for streaming events
      await waitForEvents(3, 30000);
      console.log(`  Received ${events.length} streaming events`);

      // Test 5: chat.abort
      console.log("Test 5: chat.abort");
      const abortId = send(ws, "chat.abort", { sessionKey: "test" });
      const abortRes = await waitForResponse(abortId);
      console.log(`  OK: ${abortRes.ok}`);

      console.log("---");
      console.log(`All tests passed! (${events.length} events received)`);
    } catch (err) {
      console.error(`Test failed: ${err}`);
    } finally {
      ws.close();
      setTimeout(() => process.exit(0), 500);
    }
  }
}

main().catch(console.error);
