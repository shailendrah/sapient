/**
 * Discord channel plugin — uses discord.js.
 *
 * Config required:
 *   channels.discord: {
 *     enabled: true,
 *     token: "bot-token...",
 *     dmPolicy: "open",
 *   }
 */

import type { ChannelPlugin, ChannelAccount } from "@sapient/shared";

export const discordPlugin: ChannelPlugin = {
  id: "discord",
  meta: {
    id: "discord",
    label: "Discord",
    description: "Discord bot via discord.js",
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
      const dc = config as { enabled?: boolean; token?: string };
      if (!dc.token) return [];
      return [
        { id: "default", label: "Discord Bot", enabled: dc.enabled !== false },
      ];
    },
  },
  lifecycle: {
    async start(account, config, onMessage) {
      const { token } = config as { token: string };
      const { Client, GatewayIntentBits } = await import("discord.js");

      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      client.on("messageCreate", (msg) => {
        if (msg.author.bot) return;

        onMessage({
          id: msg.id,
          channelId: "discord",
          accountId: account.id,
          from: msg.author.id,
          fromDisplayName: msg.author.displayName ?? msg.author.username,
          text: msg.content,
          chatType: msg.guild ? "group" : "direct",
          groupId: msg.guild?.id,
          threadId: msg.channel.isThread() ? msg.channel.id : undefined,
          timestamp: msg.createdTimestamp,
        });
      });

      await client.login(token);
      console.log(`[Discord] Connected (${account.id})`);
      (account as any)._client = client;
    },
    async stop(account) {
      const client = (account as any)._client;
      if (client) {
        await client.destroy();
        console.log(`[Discord] Disconnected (${account.id})`);
      }
    },
  },
  outbound: {
    async send(account, to, message) {
      const client = (account as any)._client;
      if (!client) throw new Error("Discord not connected");

      const channel = await client.channels.fetch(to);
      if (!channel?.isTextBased()) throw new Error("Not a text channel");

      // Chunk to Discord's 2000 char limit
      const text = message.text ?? "";
      const chunks =
        text.length <= 2000
          ? [text]
          : text.match(/.{1,2000}/gs) ?? [text.slice(0, 2000)];

      let messageId: string | undefined;
      for (const chunk of chunks) {
        const sent = await (channel as any).send(chunk);
        messageId ??= sent.id;
      }

      return { messageId };
    },
  },
  security: {
    isAllowed: () => true,
    dmPolicy: "open",
  },
};

export default discordPlugin;
