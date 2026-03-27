/**
 * Telegram channel plugin — uses grammy.
 *
 * Config required:
 *   channels.telegram: {
 *     enabled: true,
 *     token: "123456:ABC-DEF...",
 *     dmPolicy: "pairing",
 *   }
 */

import type {
  ChannelPlugin,
  ChannelAccount,
  InboundMessage,
} from "@sapient/shared";

export const telegramPlugin: ChannelPlugin = {
  id: "telegram",
  meta: {
    id: "telegram",
    label: "Telegram",
    description: "Telegram Bot API via grammy",
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
      const tg = config as { enabled?: boolean; token?: string };
      if (!tg.token) return [];
      return [
        { id: "default", label: "Telegram Bot", enabled: tg.enabled !== false },
      ];
    },
  },
  lifecycle: {
    async start(account, config, onMessage) {
      const { token } = config as { token: string };
      const { Bot } = await import("grammy");

      const bot = new Bot(token);

      bot.on("message:text", (ctx) => {
        const msg = ctx.message;
        onMessage({
          id: msg.message_id.toString(),
          channelId: "telegram",
          accountId: account.id,
          from: msg.from.id.toString(),
          fromDisplayName:
            msg.from.first_name +
            (msg.from.last_name ? ` ${msg.from.last_name}` : ""),
          text: msg.text,
          chatType: msg.chat.type === "private" ? "direct" : "group",
          groupId:
            msg.chat.type !== "private" ? msg.chat.id.toString() : undefined,
          threadId: msg.message_thread_id?.toString(),
          replyToId: msg.reply_to_message?.message_id?.toString(),
          timestamp: msg.date * 1000,
        });
      });

      bot.start();
      console.log(`[Telegram] Connected (${account.id})`);
      (account as any)._bot = bot;
    },
    async stop(account) {
      const bot = (account as any)._bot;
      if (bot) {
        bot.stop();
        console.log(`[Telegram] Disconnected (${account.id})`);
      }
    },
  },
  outbound: {
    async send(account, to, message) {
      const bot = (account as any)._bot;
      if (!bot) throw new Error("Telegram not connected");

      const result = await bot.api.sendMessage(to, message.text ?? "", {
        parse_mode: "HTML",
      });

      return { messageId: result.message_id.toString() };
    },
    async sendTyping(account, to) {
      const bot = (account as any)._bot;
      if (bot) {
        await bot.api.sendChatAction(to, "typing");
      }
    },
  },
  security: {
    isAllowed: () => true,
    dmPolicy: "pairing",
  },
};

export default telegramPlugin;
