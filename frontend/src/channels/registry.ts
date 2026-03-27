/**
 * Channel plugin registry — discovers and manages channel plugins.
 * Simplified from OpenClaw's complex build-time scanning to runtime registration.
 */

import type {
  ChannelPlugin,
  ChannelId,
  ChannelAccount,
  InboundMessage,
} from "@sapient/shared";
import { isAllowed, createPairingRequest } from "../auth/pairing.js";

export interface RegisteredChannel {
  plugin: ChannelPlugin;
  activeAccounts: Map<string, ChannelAccount>;
  status: "stopped" | "starting" | "running" | "error";
  error?: string;
}

export class ChannelRegistry {
  private channels = new Map<ChannelId, RegisteredChannel>();
  private messageHandler?: (msg: InboundMessage) => void;

  /** Register a channel plugin. */
  register(plugin: ChannelPlugin): void {
    this.channels.set(plugin.id, {
      plugin,
      activeAccounts: new Map(),
      status: "stopped",
    });
  }

  /** Set the handler for inbound messages from all channels. */
  onMessage(handler: (msg: InboundMessage) => void): void {
    this.messageHandler = handler;
  }

  /** Start a specific channel with its config. */
  async startChannel(
    channelId: ChannelId,
    config: Record<string, unknown>,
  ): Promise<void> {
    const registered = this.channels.get(channelId);
    if (!registered) {
      throw new Error(`Channel not registered: ${channelId}`);
    }

    const { plugin } = registered;
    registered.status = "starting";

    // Determine DM policy: channel config > plugin default > "open"
    const dmPolicy =
      (config as any).dmPolicy ??
      plugin.security?.dmPolicy ??
      "open";
    const configAllowFrom = (config as any).allowFrom as string[] | undefined;

    try {
      const accounts = plugin.config.resolveAccounts(config);
      for (const account of accounts) {
        if (!account.enabled) continue;
        if (plugin.lifecycle) {
          await plugin.lifecycle.start(account, config, (msg) => {
            // Enforce pairing/allow list at ingress
            if (dmPolicy === "pairing") {
              if (!isAllowed(channelId, msg.from, configAllowFrom)) {
                const code = createPairingRequest(channelId, msg.from);
                console.log(
                  `[Channel:${channelId}] Pairing required for ${msg.from} — code: ${code}`,
                );
                // Send pairing challenge back through the channel if outbound is available
                if (plugin.outbound) {
                  plugin.outbound.send(account, msg.from, {
                    text: `🔒 Pairing required. Your code: ${code}\nAsk the admin to approve with: sapient pairing approve ${channelId} ${code}`,
                  }).catch(() => {});
                }
                return;
              }
            }

            // Plugin-level security check (if the plugin implements something beyond the default)
            if (plugin.security && !plugin.security.isAllowed(msg.from, config)) {
              console.log(
                `[Channel:${channelId}] Blocked message from ${msg.from} (plugin security)`,
              );
              return;
            }

            this.messageHandler?.(msg);
          });
        }
        registered.activeAccounts.set(account.id, account);
      }
      registered.status = "running";
    } catch (err) {
      registered.status = "error";
      registered.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** Stop a specific channel. */
  async stopChannel(channelId: ChannelId): Promise<void> {
    const registered = this.channels.get(channelId);
    if (!registered) return;

    for (const account of registered.activeAccounts.values()) {
      if (registered.plugin.lifecycle) {
        await registered.plugin.lifecycle.stop(account);
      }
    }
    registered.activeAccounts.clear();
    registered.status = "stopped";
  }

  /** Stop all channels. */
  async stopAll(): Promise<void> {
    for (const channelId of this.channels.keys()) {
      await this.stopChannel(channelId);
    }
  }

  /** Get all registered channels. */
  list(): RegisteredChannel[] {
    return Array.from(this.channels.values());
  }

  /** Get a registered channel by ID. */
  get(channelId: ChannelId): RegisteredChannel | undefined {
    return this.channels.get(channelId);
  }

  /** Send a reply through a channel. */
  async sendReply(
    channelId: ChannelId,
    accountId: string,
    to: string,
    message: { text?: string; mediaUrls?: string[] },
  ): Promise<void> {
    const registered = this.channels.get(channelId);
    if (!registered?.plugin.outbound) {
      throw new Error(`Channel ${channelId} has no outbound adapter`);
    }
    const account = registered.activeAccounts.get(accountId);
    if (!account) {
      throw new Error(`No active account ${accountId} on channel ${channelId}`);
    }
    await registered.plugin.outbound.send(account, to, message);
  }
}
