/**
 * Configuration types 
 */

/** Default model alias — resolved by the Claude Agent SDK. */
export const DEFAULT_MODEL = "sonnet";

/** Root configuration for Sapient. */
export interface SapientConfig {
  gateway?: GatewayConfig;
  agent?: AgentConfig;
  channels?: ChannelsConfig;
  auth?: AuthConfig;
}

/** Gateway server configuration. */
export interface GatewayConfig {
  /** Port for the WebSocket server. Default: 18789. */
  port?: number;
  /** Bind mode. Default: "loopback". */
  bind?: "loopback" | "lan" | "custom";
  /** Custom bind host (when bind is "custom"). */
  customBindHost?: string;
  /** Auth mode. Default: "token". */
  authMode?: "none" | "token" | "password";
  /** Auth token (auto-generated if not set). */
  token?: string;
}

/** Supported LLM providers. */
export type LLMProvider = "anthropic" | "together" | "openai" | "ollama" | "custom";

/** Agent (Claude Agent SDK) configuration. */
export interface AgentConfig {
  /** LLM provider. Default: "anthropic". Non-anthropic providers are routed through LiteLLM. */
  provider?: LLMProvider;
  /** Anthropic API key. Supports $secret:name or ${ENV_VAR} syntax. */
  apiKey?: string;
  /** API key for non-Anthropic providers (Together, OpenAI, etc.). */
  providerApiKey?: string;
  /** Custom base URL for the provider (only used when provider is "custom"). */
  providerBaseUrl?: string;
  /** Model to use. Default: "sonnet". For non-Anthropic providers, use the full model ID (e.g., "meta-llama/Llama-3.3-70B-Instruct-Turbo"). */
  model?: string;
  /** System prompt override. */
  systemPrompt?: string;
  /** Max tokens per response. */
  maxTokens?: number;
  /** Permission mode for tool use. */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  /** Subagent definitions. */
  subagents?: SubagentConfig[];
  /** Custom tools directory. */
  toolsDir?: string;
  /** Workspace directory for AGENTS.md, SOUL.md, etc. */
  workspaceDir?: string;
  /**
   * MCP server configurations. Keys are server names.
   * Supports stdio, HTTP, and SSE transports.
   *
   * @example
   * {
   *   "my-tools": { command: "node", args: ["./mcp-server.js"] },
   *   "remote":   { type: "http", url: "https://mcp.example.com/mcp" }
   * }
   */
  mcpServers?: Record<string, McpServerSpec>;
}

/** MCP server configuration — stdio (default), HTTP, or SSE transport. */
export type McpServerSpec =
  | McpStdioSpec
  | McpHttpSpec
  | McpSseSpec;

export interface McpStdioSpec {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpSpec {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export interface McpSseSpec {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

export interface SubagentConfig {
  name: string;
  description: string;
  systemPrompt?: string;
  allowedTools?: string[];
}

/** Per-channel configuration. */
export interface ChannelsConfig {
  /** Default settings for all channels. */
  defaults?: ChannelDefaults;
  /** Channel-specific settings keyed by channel ID. */
  [channelId: string]: ChannelInstanceConfig | ChannelDefaults | undefined;
}

export interface ChannelDefaults {
  /** Default DM policy. */
  dmPolicy?: "open" | "pairing";
  /** Default allowFrom list. */
  allowFrom?: string[];
}

export interface ChannelInstanceConfig {
  enabled?: boolean;
  allowFrom?: string[];
  dmPolicy?: "open" | "pairing";
  /** Channel-specific settings (e.g., Slack token, Telegram bot token). */
  [key: string]: unknown;
}

/** Authentication configuration. */
export interface AuthConfig {
  /** Auth mode. */
  mode?: "none" | "token" | "password";
  /** Secret token for gateway auth (used when mode is "token"). */
  token?: string;
  /** Password for gateway auth (used when mode is "password"). */
  password?: string;
}

/** Session tracking (lightweight). */
export interface Session {
  id: string;
  /** Session key: "main", "@channelId:userId", etc. */
  key: string;
  channelId?: string;
  accountId?: string;
  from?: string;
  chatType?: "direct" | "group" | "channel";
  createdAt: number;
  updatedAt: number;
  status: "active" | "idle" | "ended";
}
