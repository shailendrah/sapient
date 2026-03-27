/**
 * Gateway protocol types — WebSocket frames between clients and the gateway server.
 */

/** Client handshake parameters. */
export interface ConnectParams {
  client: {
    id: string;
    displayName?: string;
    version: string;
    platform: string;
  };
  auth?: {
    token?: string;
    password?: string;
  };
}

/** Server handshake response. */
export interface HelloOk {
  type: "hello-ok";
  server: {
    version: string;
    connId: string;
  };
  methods: string[];
  events: string[];
  /** Whether this device is paired/approved. */
  paired?: boolean;
  /** Assigned device name (for pairing approval). */
  deviceName?: string;
}

/** Client → Server: RPC method call. */
export interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

/** Server → Client: RPC method result. */
export interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: GatewayError;
}

/** Server → Client: Broadcast event. */
export interface EventFrame {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
}

export interface GatewayError {
  code: string;
  message: string;
  retryable?: boolean;
}

/** Union of all frame types flowing over the WebSocket. */
export type GatewayFrame = RequestFrame | ResponseFrame | EventFrame;
