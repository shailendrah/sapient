/**
 * WebChat channel plugin — built-in browser chat interface.
 * Messages come through the gateway WebSocket directly (no external service).
 * This is the "always works" fallback channel.
 *
 * No external config needed — uses the gateway WebSocket connection.
 */

import type { ChannelPlugin, ChannelAccount } from "@sapient/shared";

export const webchatPlugin: ChannelPlugin = {
  id: "webchat",
  meta: {
    id: "webchat",
    label: "WebChat",
    description: "Built-in browser chat interface via gateway WebSocket",
  },
  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    edit: false,
    reply: false,
    threads: false,
    media: false,
  },
  config: {
    resolveAccounts() {
      // WebChat is always available
      return [{ id: "default", label: "WebChat", enabled: true }];
    },
  },
  // No lifecycle needed — messages come through gateway chat.send RPC
  // No outbound needed — responses stream back via gateway WebSocket events
  security: {
    isAllowed: () => true,
    dmPolicy: "open",
  },
};

export default webchatPlugin;
