/**
 * BlueBubbles (iMessage) channel plugin.
 * Connects to a BlueBubbles server via REST API + webhooks.
 *
 * Config required:
 *   channels.bluebubbles: {
 *     enabled: true,
 *     serverUrl: "http://localhost:1234",
 *     password: "your-api-password",
 *     dmPolicy: "pairing",
 *   }
 */

import type { ChannelPlugin, ChannelAccount } from "@sapient/shared";

export const blueBubblesPlugin: ChannelPlugin = {
  id: "bluebubbles",
  meta: {
    id: "bluebubbles",
    label: "iMessage (BlueBubbles)",
    description: "iMessage via BlueBubbles server",
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: true,
    edit: false,
    reply: true,
    threads: false,
    media: true,
  },
  config: {
    resolveAccounts(config) {
      const bb = config as {
        enabled?: boolean;
        serverUrl?: string;
        password?: string;
      };
      if (!bb.serverUrl || !bb.password) return [];
      return [
        {
          id: "default",
          label: "iMessage",
          enabled: bb.enabled !== false,
        },
      ];
    },
  },
  lifecycle: {
    async start(account, config, onMessage) {
      const { serverUrl, password } = config as {
        serverUrl: string;
        password: string;
      };

      const apiUrl = serverUrl.replace(/\/$/, "");

      // Verify connection
      const res = await fetch(`${apiUrl}/api/v1/server/info`, {
        headers: { Authorization: `Bearer ${password}` },
      });
      if (!res.ok) throw new Error(`BlueBubbles connection failed: ${res.status}`);

      console.log(`[BlueBubbles] Connected to ${apiUrl} (${account.id})`);

      // TODO: Register webhook for inbound messages.
      // BlueBubbles sends webhooks to a configurable URL when messages arrive.
      // For now, we'd need the gateway HTTP server to expose a webhook endpoint.
      // The webhook handler would call onMessage() with normalized messages.

      (account as any)._apiUrl = apiUrl;
      (account as any)._password = password;
    },
    async stop(account) {
      console.log(`[BlueBubbles] Disconnected (${account.id})`);
    },
  },
  outbound: {
    async send(account, to, message) {
      const apiUrl = (account as any)._apiUrl as string;
      const password = (account as any)._password as string;
      if (!apiUrl) throw new Error("BlueBubbles not connected");

      const res = await fetch(`${apiUrl}/api/v1/message/text`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${password}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatGuid: to,
          message: message.text ?? "",
        }),
      });

      if (!res.ok) throw new Error(`BlueBubbles send failed: ${res.status}`);
      const data = (await res.json()) as { data?: { guid?: string } };
      return { messageId: data.data?.guid };
    },
  },
  security: {
    isAllowed: () => true,
    dmPolicy: "pairing",
  },
};

export default blueBubblesPlugin;
