/**
 * WhatsApp channel plugin — uses @whiskeysockets/baileys.
 * Requires QR-based authentication on first run.
 *
 * Config required:
 *   channels.whatsapp: {
 *     enabled: true,
 *     dmPolicy: "pairing",
 *   }
 */

import type { ChannelPlugin, ChannelAccount } from "@sapient/shared";
import path from "node:path";
import os from "node:os";

export const whatsappPlugin: ChannelPlugin = {
  id: "whatsapp",
  meta: {
    id: "whatsapp",
    label: "WhatsApp",
    description: "WhatsApp via Baileys (QR-based login)",
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
      const wa = config as { enabled?: boolean };
      return [
        { id: "default", label: "WhatsApp", enabled: wa.enabled !== false },
      ];
    },
  },
  lifecycle: {
    async start(account, config, onMessage) {
      // Dynamic import — baileys is an optional dependency
      const baileys: any = await import("@whiskeysockets/baileys");
      const makeWASocket = baileys.default ?? baileys.makeWASocket;
      const useMultiFileAuthState = baileys.useMultiFileAuthState;
      const DisconnectReason = baileys.DisconnectReason;

      const stateDir =
        process.env.SAPIENT_STATE_DIR ??
        path.join(os.homedir(), ".sapient");
      const authDir = path.join(stateDir, "whatsapp-auth", account.id);

      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", (update: any) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          console.log(
            `[WhatsApp] Scan QR code to authenticate (${account.id})`,
          );
        }
        if (connection === "close") {
          const reason = (lastDisconnect?.error as any)?.output?.statusCode;
          if (reason !== DisconnectReason?.loggedOut) {
            console.log("[WhatsApp] Reconnecting...");
          } else {
            console.log("[WhatsApp] Logged out");
          }
        }
        if (connection === "open") {
          console.log(`[WhatsApp] Connected (${account.id})`);
        }
      });

      sock.ev.on("messages.upsert", ({ messages }: any) => {
        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;
          const text =
            msg.message.conversation ??
            msg.message.extendedTextMessage?.text ??
            "";
          if (!text) continue;

          const from = msg.key.remoteJid ?? "";
          const isGroup = from.endsWith("@g.us");

          onMessage({
            id: msg.key.id ?? Date.now().toString(),
            channelId: "whatsapp",
            accountId: account.id,
            from: msg.key.participant ?? from,
            text,
            chatType: isGroup ? "group" : "direct",
            groupId: isGroup ? from : undefined,
            timestamp: (msg.messageTimestamp as number) * 1000,
          });
        }
      });

      (account as any)._sock = sock;
    },
    async stop(account) {
      const sock = (account as any)._sock;
      if (sock) {
        sock.end(undefined);
        console.log(`[WhatsApp] Disconnected (${account.id})`);
      }
    },
  },
  outbound: {
    async send(account, to, message) {
      const sock = (account as any)._sock;
      if (!sock) throw new Error("WhatsApp not connected");

      const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;
      const result = await sock.sendMessage(jid, { text: message.text ?? "" });
      return { messageId: result?.key?.id };
    },
  },
  security: {
    isAllowed: () => true,
    dmPolicy: "pairing",
  },
};

export default whatsappPlugin;
