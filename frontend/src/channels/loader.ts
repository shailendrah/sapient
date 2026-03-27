/**
 * Channel loader — discovers and registers available channel plugins at runtime.
 * Uses dynamic import with URL resolution to avoid rootDir issues.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ChannelPlugin } from "@sapient/shared";
import { ChannelRegistry } from "./registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve the path to a channel extension's compiled output. */
function extensionPath(channelId: string): string {
  // In dist output: dist/src/channels/loader.js
  // Extensions at: dist/extensions/<channelId>/index.js
  return path.resolve(__dirname, "../../extensions", channelId, "index.js");
}

async function loadPlugin(channelId: string): Promise<ChannelPlugin> {
  const modPath = extensionPath(channelId);
  const mod = await import(modPath);
  return mod.default as ChannelPlugin;
}

const BUILTIN_CHANNEL_IDS = [
  "slack",
  "telegram",
  "discord",
  "whatsapp",
  "webchat",
  "bluebubbles",
  "google-chat",
];

/**
 * Load and register all available channel plugins.
 * Only loads channels that are configured — skips the rest.
 */
export async function loadChannels(
  registry: ChannelRegistry,
  channelsConfig: Record<string, unknown>,
): Promise<void> {
  // Always register webchat
  try {
    const webchat = await loadPlugin("webchat");
    registry.register(webchat);
  } catch (err) {
    console.error(`[Loader] Failed to load webchat: ${err}`);
  }

  // Register configured channels
  for (const channelId of BUILTIN_CHANNEL_IDS) {
    if (channelId === "webchat") continue;

    const channelConfig = channelsConfig[channelId];
    if (!channelConfig || typeof channelConfig !== "object") continue;
    if ((channelConfig as any).enabled === false) continue;

    try {
      const plugin = await loadPlugin(channelId);
      registry.register(plugin);
      console.log(`[Loader] Registered channel: ${channelId}`);
    } catch (err) {
      console.error(
        `[Loader] Failed to load channel ${channelId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

/**
 * Start all registered and configured channels.
 */
export async function startChannels(
  registry: ChannelRegistry,
  channelsConfig: Record<string, unknown>,
): Promise<void> {
  for (const channel of registry.list()) {
    const config = channelsConfig[channel.plugin.id];
    if (!config || typeof config !== "object") continue;

    try {
      await registry.startChannel(channel.plugin.id, config as Record<string, unknown>);
      console.log(`[Loader] Started channel: ${channel.plugin.id}`);
    } catch (err) {
      console.error(
        `[Loader] Failed to start channel ${channel.plugin.id}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
