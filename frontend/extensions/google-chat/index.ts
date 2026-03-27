/**
 * Google Chat channel plugin.
 * Uses Google Chat API with service account authentication.
 *
 * Config required:
 *   channels["google-chat"]: {
 *     enabled: true,
 *     serviceAccountFile: "/path/to/service-account.json",
 *     dmPolicy: "pairing",
 *   }
 */

import type { ChannelPlugin, ChannelAccount } from "@sapient/shared";

export const googleChatPlugin: ChannelPlugin = {
  id: "google-chat",
  meta: {
    id: "google-chat",
    label: "Google Chat",
    description: "Google Chat via service account",
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: true,
    edit: true,
    reply: true,
    threads: true,
    media: true,
  },
  config: {
    resolveAccounts(config) {
      const gc = config as {
        enabled?: boolean;
        serviceAccountFile?: string;
        serviceAccount?: string;
      };
      if (!gc.serviceAccountFile && !gc.serviceAccount) return [];
      return [
        {
          id: "default",
          label: "Google Chat Bot",
          enabled: gc.enabled !== false,
        },
      ];
    },
  },
  lifecycle: {
    async start(account, config, onMessage) {
      const { serviceAccountFile, serviceAccount } = config as {
        serviceAccountFile?: string;
        serviceAccount?: string;
      };

      // Load service account credentials
      const { GoogleAuth } = await import("google-auth-library");
      let auth: InstanceType<typeof GoogleAuth>;

      if (serviceAccountFile) {
        auth = new GoogleAuth({
          keyFile: serviceAccountFile,
          scopes: ["https://www.googleapis.com/auth/chat.bot"],
        });
      } else if (serviceAccount) {
        const credentials =
          typeof serviceAccount === "string"
            ? JSON.parse(serviceAccount)
            : serviceAccount;
        auth = new GoogleAuth({
          credentials,
          scopes: ["https://www.googleapis.com/auth/chat.bot"],
        });
      } else {
        throw new Error("Google Chat: serviceAccountFile or serviceAccount required");
      }

      const client = await auth.getClient();
      console.log(`[Google Chat] Authenticated (${account.id})`);

      // TODO: Register webhook for inbound messages.
      // Google Chat sends webhooks to a configured URL.
      // The webhook handler would verify JWT signature and call onMessage().

      (account as any)._auth = auth;
      (account as any)._client = client;
    },
    async stop(account) {
      console.log(`[Google Chat] Disconnected (${account.id})`);
    },
  },
  outbound: {
    async send(account, to, message) {
      const client = (account as any)._client;
      if (!client) throw new Error("Google Chat not connected");

      const token = await client.getAccessToken();
      const res = await fetch(
        `https://chat.googleapis.com/v1/${to}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: message.text ?? "",
          }),
        },
      );

      if (!res.ok) throw new Error(`Google Chat send failed: ${res.status}`);
      const data = (await res.json()) as { name?: string };
      return { messageId: data.name };
    },
  },
  security: {
    isAllowed: () => true,
    dmPolicy: "pairing",
  },
};

export default googleChatPlugin;
