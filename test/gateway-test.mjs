#!/usr/bin/env node

/**
 * Gateway integration test — connects via Node's built-in WebSocket,
 * sends RPC calls, and verifies streaming events.
 *
 * Usage:
 *   1. Start the gateway: node frontend/dist/src/cli/index.js start
 *   2. In another terminal: node test/gateway-test.mjs
 */

const PORT = process.env.PORT ?? "18789";
const HOST = process.env.HOST ?? "127.0.0.1";
const WS_URL = `ws://${HOST}:${PORT}`;

let reqId = 0;
function nextId() {
  return `test_${++reqId}`;
}

const responses = new Map();
const events = [];
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

async function main() {
  console.log(`Connecting to ${WS_URL}...\n`);

  const ws = new WebSocket(WS_URL);

  function send(method, params) {
    const id = nextId();
    ws.send(JSON.stringify({ type: "req", id, method, params }));
    return id;
  }

  async function waitForResponse(id, timeoutMs = 5000) {
    const start = Date.now();
    while (!responses.has(id)) {
      if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${id}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    return responses.get(id);
  }

  async function waitForEvents(count, timeoutMs = 30000) {
    const start = Date.now();
    while (events.length < count) {
      if (Date.now() - start > timeoutMs) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "hello-ok") {
      console.log(`Connected: server v${msg.server.version}, conn=${msg.server.connId}`);
      console.log(`Methods: ${msg.methods.join(", ")}`);
      console.log(`Events: ${msg.events.length} event types\n`);
      runTests();
      return;
    }

    if (msg.type === "res") {
      responses.set(msg.id, msg);
      return;
    }

    if (msg.type === "event") {
      events.push(msg);
      const dataType = msg.payload?.data?.type ?? msg.event;
      console.log(`  [EVENT] ${dataType}`);
    }
  });

  ws.addEventListener("error", (err) => {
    console.error(`Connection error: ${err.message ?? err}`);
    process.exit(1);
  });

  async function runTests() {
    try {
      // Test 1: channels.list
      console.log("Test 1: channels.list");
      const chRes = await waitForResponse(send("channels.list"));
      assert(chRes.ok, "channels.list should return ok");
      assert(Array.isArray(chRes.payload?.channels), "should return channels array");
      console.log(`  OK — ${chRes.payload.channels.length} channels\n`);

      // Test 2: sessions.list
      console.log("Test 2: sessions.list");
      const sessRes = await waitForResponse(send("sessions.list"));
      assert(sessRes.ok, "sessions.list should return ok");
      assert(Array.isArray(sessRes.payload?.sessions), "should return sessions array");
      console.log(`  OK — ${sessRes.payload.sessions.length} sessions\n`);

      // Test 3: config.get
      console.log("Test 3: config.get");
      const cfgRes = await waitForResponse(send("config.get"));
      assert(cfgRes.ok, "config.get should return ok");
      assert(cfgRes.payload?.config != null, "should return config object");
      console.log(`  OK — model: ${cfgRes.payload.config?.agent?.model ?? "(default)"}\n`);

      // Test 4: chat.send
      console.log("Test 4: chat.send (with streaming events)");
      events.length = 0;
      const chatRes = await waitForResponse(
        send("chat.send", { sessionKey: "test", message: "Say hello in 10 words or less." }),
      );
      assert(chatRes.ok, "chat.send should return ok");
      assert(chatRes.payload?.runId, "should return runId");
      console.log(`  Started: runId=${chatRes.payload.runId}`);

      // Wait for streaming events (agent.start, text.delta, text.done, agent.complete)
      await waitForEvents(3, 30000);
      assert(events.length >= 2, `should receive streaming events (got ${events.length})`);
      console.log(`  OK — ${events.length} streaming events received\n`);

      // Test 5: sessions.list should now have the test session
      console.log("Test 5: sessions.list (after chat)");
      const sessRes2 = await waitForResponse(send("sessions.list"));
      assert(sessRes2.payload?.sessions?.length > 0, "should have at least 1 session");
      console.log(`  OK — ${sessRes2.payload.sessions.length} sessions\n`);

      // Test 6: chat.abort
      console.log("Test 6: chat.abort");
      const abortRes = await waitForResponse(send("chat.abort", { sessionKey: "test" }));
      assert(abortRes.ok, "chat.abort should return ok");
      console.log(`  OK\n`);

      // Test 7: config.patch
      console.log("Test 7: config.patch");
      const patchRes = await waitForResponse(
        send("config.patch", { patch: { agent: { maxTokens: 2048 } } }),
      );
      assert(patchRes.ok, "config.patch should return ok");
      console.log(`  OK\n`);

      // Test 8: pairing.list
      console.log("Test 8: pairing.list");
      const pairRes = await waitForResponse(send("pairing.list", { channelId: "slack" }));
      assert(pairRes.ok, "pairing.list should return ok");
      console.log(`  OK — ${pairRes.payload?.requests?.length ?? 0} pending\n`);

      // Test 9: unknown method
      console.log("Test 9: unknown method");
      const unknownRes = await waitForResponse(send("nonexistent.method"));
      assert(!unknownRes.ok, "unknown method should return error");
      assert(unknownRes.error?.code === "METHOD_NOT_FOUND", "error code should be METHOD_NOT_FOUND");
      console.log(`  OK — ${unknownRes.error.code}\n`);

      // Summary
      console.log("=".repeat(40));
      console.log(`Results: ${passed} passed, ${failed} failed`);
      if (failed === 0) {
        console.log("All tests passed!");
      }
    } catch (err) {
      console.error(`Test error: ${err}`);
    } finally {
      ws.close();
      setTimeout(() => process.exit(failed > 0 ? 1 : 0), 500);
    }
  }
}

main().catch(console.error);
