/**
 * Configuration types — simplified from OpenClaw's 220+ config fields.
 * Only what Sapient needs.
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

/** Agent (Claude Agent SDK) configuration. */
export interface AgentConfig {
  /** Anthropic API key. Supports $secret:name or ${ENV_VAR} syntax. */
  apiKey?: string;
  /** Model to use. Default: "sonnet". Accepts aliases: "sonnet", "opus", "haiku", or full model IDs. */
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
