/**
 * Slack channel plugin — uses @slack/bolt (Socket Mode).
 *
 * Config required in config.json5:
 *   channels.slack: {
 *     enabled: true,
 *     botToken: "xoxb-...",
 *     appToken: "xapp-...",
 *     dmPolicy: "pairing",
 *   }
 */

import type {
  ChannelPlugin,
  ChannelAccount,
  InboundMessage,
  OutboundMessage,
} from "@sapient/shared";

export const slackPlugin: ChannelPlugin = {
  id: "slack",
  meta: {
    id: "slack",
    label: "Slack",
    description: "Slack workspace integration via Socket Mode",
  },
  capabilities: {
    chatTypes: ["direct", "group", "channel"],
    reactions: true,
    edit: true,
    reply: true,
    threads: true,
    media: true,
  },
  config: {
    resolveAccounts(config) {
      const slack = config as {
        enabled?: boolean;
        botToken?: string;
        appToken?: string;
      };
      if (!slack.botToken || !slack.appToken) return [];
      return [
        {
          id: "default",
          label: "Slack Bot",
          enabled: slack.enabled !== false,
        },
      ];
    },
  },
  lifecycle: {
    async start(account, config, onMessage) {
      const { botToken, appToken } = config as {
        botToken: string;
        appToken: string;
      };

      // Dynamic import to avoid requiring @slack/bolt unless channel is enabled
      const { App } = await import("@slack/bolt");

      const app = new App({
        token: botToken,
        appToken,
        socketMode: true,
      });

      app.message(async ({ message, say }) => {
        // Skip bot messages
        if ("bot_id" in message) return;
        const msg = message as {
          user?: string;
          text?: string;
          channel?: string;
          ts?: string;
          thread_ts?: string;
        };

        if (!msg.text || !msg.user) return;

        onMessage({
          id: msg.ts ?? Date.now().toString(),
          channelId: "slack",
          accountId: account.id,
          from: msg.user,
          text: msg.text,
          chatType: "direct",
          groupId: msg.channel,
          threadId: msg.thread_ts,
          timestamp: Date.now(),
        });
      });

      await app.start();
      console.log(`[Slack] Connected (${account.id})`);

      // Store app reference for cleanup
      (account as any)._app = app;
    },
    async stop(account) {
      const app = (account as any)._app;
      if (app) {
        await app.stop();
        console.log(`[Slack] Disconnected (${account.id})`);
      }
    },
  },
  outbound: {
    async send(account, to, message) {
      const app = (account as any)._app;
      if (!app) throw new Error("Slack not connected");

      const result = await app.client.chat.postMessage({
        channel: to,
        text: message.text ?? "",
      });

      return { messageId: result.ts };
    },
    async sendTyping(account, to) {
      // Slack doesn't have a direct typing indicator API for bots
    },
  },
  security: {
    isAllowed: () => true,
    dmPolicy: "pairing",
  },
};

export default slackPlugin;
