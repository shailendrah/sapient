/**
 * Gateway WebSocket server — the control plane for Sapient.
 * Handles client connections, message routing, and streaming.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type {
  HelloOk,
  RequestFrame,
  ResponseFrame,
  EventFrame,
  GatewayConfig,
  StreamEvent,
} from "@sapient/shared";
import { authorizeConnection, type AuthConfig } from "../auth/auth.js";
import {
  createDevicePairingRequest,
  isDevicePaired,
} from "../auth/pairing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface GatewayClient {
  id: string;
  ws: WebSocket;
  connectedAt: number;
  subscribedSessions: Set<string>;
  /** Assigned device name for pairing. */
  deviceName?: string;
  /** Whether this device has been paired/approved. */
  paired: boolean;
}

export interface GatewayServer {
  wss: WebSocketServer;
  clients: Map<string, GatewayClient>;
  start(): Promise<void>;
  stop(): Promise<void>;
  broadcast(event: EventFrame): void;
  broadcastToSession(sessionKey: string, event: StreamEvent): void;
  registerMethods(handlers: Map<string, RequestHandler>): void;
}

/** Handler for incoming RPC requests from clients. */
export type RequestHandler = (
  client: GatewayClient,
  params: unknown,
) => Promise<unknown>;

export interface GatewayOptions extends GatewayConfig {
  /** Auth config for WebSocket connections. */
  auth?: AuthConfig;
}

export function createGateway(config: GatewayOptions): GatewayServer {
  const port = config.port ?? 18789;
  const host =
    config.bind === "lan"
      ? "0.0.0.0"
      : config.bind === "custom"
        ? config.customBindHost ?? "127.0.0.1"
        : "127.0.0.1";
  const authConfig = config.auth;

  const clients = new Map<string, GatewayClient>();
  const methods = new Map<string, RequestHandler>();

  const wss = new WebSocketServer({ noServer: true });

  function broadcast(event: EventFrame): void {
    const data = JSON.stringify(event);
    for (const client of clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  function broadcastToSession(sessionKey: string, event: StreamEvent): void {
    const frame: EventFrame = {
      type: "event",
      event: event.type,
      payload: event,
      seq: event.seq,
    };
    const data = JSON.stringify(frame);
    for (const client of clients.values()) {
      if (
        client.ws.readyState === WebSocket.OPEN &&
        client.subscribedSessions.has(sessionKey)
      ) {
        client.ws.send(data);
      }
    }
  }

  async function handleRequest(
    client: GatewayClient,
    frame: RequestFrame,
  ): Promise<void> {
    const handler = methods.get(frame.method);
    if (!handler) {
      const res: ResponseFrame = {
        type: "res",
        id: frame.id,
        ok: false,
        error: { code: "METHOD_NOT_FOUND", message: `Unknown method: ${frame.method}` },
      };
      client.ws.send(JSON.stringify(res));
      return;
    }

    try {
      const result = await handler(client, frame.params);
      const res: ResponseFrame = {
        type: "res",
        id: frame.id,
        ok: true,
        payload: result,
      };
      client.ws.send(JSON.stringify(res));
    } catch (err) {
      const res: ResponseFrame = {
        type: "res",
        id: frame.id,
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      };
      client.ws.send(JSON.stringify(res));
    }
  }

  wss.on("connection", (ws: WebSocket) => {
    const connId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Create device pairing request and check if already approved
    const deviceName = createDevicePairingRequest(connId);
    const paired = isDevicePaired(deviceName);

    const client: GatewayClient = {
      id: connId,
      ws,
      connectedAt: Date.now(),
      subscribedSessions: new Set(["main"]),
      deviceName,
      paired,
    };
    clients.set(connId, client);

    if (!paired) {
      console.log(`[Gateway] New device ${deviceName} awaiting pairing (${connId})`);
    }

    // Send hello with pairing status
    const hello: HelloOk = {
      type: "hello-ok",
      server: { version: "0.1.0", connId },
      methods: Array.from(methods.keys()),
      paired,
      deviceName,
      events: [
        "agent.start",
        "agent.complete",
        "agent.error",
        "text.delta",
        "text.done",
        "tool.use",
        "tool.result",
        "subagent.start",
        "subagent.complete",
        "approval.request",
        "approval.response",
      ],
    };
    ws.send(JSON.stringify(hello));

    ws.on("message", (raw: Buffer) => {
      try {
        const frame = JSON.parse(raw.toString()) as RequestFrame;
        if (frame.type === "req") {
          handleRequest(client, frame);
        }
      } catch {
        // Ignore malformed frames
      }
    });

    ws.on("close", () => {
      clients.delete(connId);
    });
  });

  // Serve the Web UI from the ui/ directory
  const uiDir = path.resolve(__dirname, "../../../ui");

  const MIME_TYPES: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };

  const httpServer = http.createServer((req, res) => {
    if (!req.url || req.method !== "GET") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // Parse URL to strip query params for file path
    const parsedUrl = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    let filePath = path.join(uiDir, parsedUrl.pathname === "/" ? "index.html" : parsedUrl.pathname);

    // Prevent path traversal
    if (!filePath.startsWith(uiDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    } catch {
      res.writeHead(500);
      res.end("Server error");
    }
  });

  httpServer.on("upgrade", (req: http.IncomingMessage, socket: any, head: Buffer) => {
    if (authConfig && authConfig.mode !== "none") {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const clientIp =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
        req.socket.remoteAddress ??
        "unknown";

      const result = authorizeConnection(authConfig, {
        token: url.searchParams.get("token") ?? undefined,
        password: url.searchParams.get("password") ?? undefined,
      }, clientIp);

      if (!result.ok) {
        const status = result.rateLimited ? 429 : 401;
        const reason = result.rateLimited ? "Too Many Requests" : "Unauthorized";
        socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  return {
    wss,
    clients,
    broadcast,
    broadcastToSession,
    registerMethods(handlers: Map<string, RequestHandler>) {
      for (const [name, handler] of handlers) {
        methods.set(name, handler);
      }
    },
    async start() {
      return new Promise<void>((resolve) => {
        httpServer.listen(port, host, () => {
          console.log(`[Gateway] WebSocket server listening on ws://${host}:${port}`);
          resolve();
        });
      });
    },
    async stop() {
      for (const client of clients.values()) {
        client.ws.close();
      }
      clients.clear();
      wss.close();
      httpServer.close();
    },
  };
}
