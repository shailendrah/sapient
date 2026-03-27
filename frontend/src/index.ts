export { createGateway } from "./gateway/server.js";
export { createMethods } from "./gateway/methods.js";
export { ChannelRegistry } from "./channels/registry.js";
export { loadConfig, writeConfig, patchConfig } from "./config/loader.js";
export { authorizeConnection, ensureAuth, generateToken } from "./auth/auth.js";
export * from "./auth/pairing.js";
export type { GatewayServer, GatewayClient } from "./gateway/server.js";
export type { GatewayContext } from "./gateway/methods.js";
