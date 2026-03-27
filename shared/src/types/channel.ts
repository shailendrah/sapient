/**
 * Channel plugin interface — the contract every channel extension must implement.
 * Simplified from OpenClaw's 30+ optional adapters to the essentials.
 */

import type { InboundMessage, OutboundMessage, ChatType } from "./message.js";

export type ChannelId = string;

/** Channel metadata for registration and display. */
export interface ChannelMeta {
  id: ChannelId;
  label: string;
  description?: string;
  icon?: string;
}

/** What this channel supports. */
export interface ChannelCapabilities {
  chatTypes: ChatType[];
  reactions?: boolean;
  edit?: boolean;
  reply?: boolean;
  threads?: boolean;
  media?: boolean;
  polls?: boolean;
}

/** The core channel plugin interface. */
export interface ChannelPlugin {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;

  /** Config adapter — resolve accounts, validate config. */
  config: ChannelConfigAdapter;

  /** Lifecycle — start/stop the channel connection. */
  lifecycle?: ChannelLifecycleAdapter;

  /** Outbound — send messages back to the channel. */
  outbound?: ChannelOutboundAdapter;

  /** Security — allowlist and DM policy enforcement. */
  security?: ChannelSecurityAdapter;

  /** Setup — interactive setup flow (OAuth, tokens, etc.). */
  setup?: ChannelSetupAdapter;
}

/** Resolve and validate channel configuration. */
export interface ChannelConfigAdapter {
  /** Resolve the active account(s) for this channel from config. */
  resolveAccounts(config: Record<string, unknown>): ChannelAccount[];
  /** Validate channel-specific config. */
  validate?(config: Record<string, unknown>): string[];
}

export interface ChannelAccount {
  id: string;
  label?: string;
  enabled: boolean;
}

/** Start/stop channel connections. */
export interface ChannelLifecycleAdapter {
  /** Start listening for inbound messages. */
  start(
    account: ChannelAccount,
    config: Record<string, unknown>,
    onMessage: (msg: InboundMessage) => void,
  ): Promise<void>;
  /** Stop the channel connection. */
  stop(account: ChannelAccount): Promise<void>;
}

/** Send messages outbound to the channel. */
export interface ChannelOutboundAdapter {
  /** Send a text/media reply. */
  send(
    account: ChannelAccount,
    to: string,
    message: OutboundMessage,
  ): Promise<{ messageId?: string }>;
  /** Send a typing indicator. */
  sendTyping?(account: ChannelAccount, to: string): Promise<void>;
}

/** Security and access control. */
export interface ChannelSecurityAdapter {
  /** Check if a sender is allowed to message. */
  isAllowed(from: string, config: Record<string, unknown>): boolean;
  /** DM policy: "open" allows anyone, "pairing" requires approval. */
  dmPolicy: "open" | "pairing";
}

/** Interactive setup flow for channel credentials. */
export interface ChannelSetupAdapter {
  /** Run the setup wizard (e.g., OAuth flow, token input). */
  setup(config: Record<string, unknown>): Promise<Record<string, unknown>>;
}
