#!/usr/bin/env node

/**
 * Sapient Slack MCP Server
 *
 * Provides full Slack API access via MCP tools. Goes beyond the channel
 * plugin (which handles inbound messages) to give the agent proactive
 * control over Slack: send messages, react, pin, search, manage channels,
 * upload files, and more.
 *
 * Env vars:
 *   SLACK_BOT_TOKEN - Bot token (xoxb-...) with required scopes
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

if (!SLACK_BOT_TOKEN) {
  console.error("[slack-mcp] SLACK_BOT_TOKEN not set");
  process.exit(1);
}

// Dynamic import to avoid requiring @slack/web-api unless configured
const { WebClient } = await import("@slack/web-api");
const slack = new WebClient(SLACK_BOT_TOKEN);

const server = new McpServer({
  name: "sapient-slack",
  version: "0.1.0",
});

// ── Messaging ─────────────────────────────────────────────────────────

server.tool(
  "slack_send",
  "Send a message to a Slack channel or user. Supports markdown formatting.",
  {
    channel: z.string().describe("Channel ID (C...) or user ID (U...) to send to"),
    text: z.string().describe("Message text (supports Slack markdown)"),
    thread_ts: z.string().optional().describe("Thread timestamp to reply in-thread"),
  },
  async ({ channel, text, thread_ts }) => {
    const result = await slack.chat.postMessage({
      channel,
      text,
      thread_ts,
    });
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, ts: result.ts, channel: result.channel }) }],
    };
  }
);

server.tool(
  "slack_edit",
  "Edit an existing Slack message.",
  {
    channel: z.string().describe("Channel ID"),
    ts: z.string().describe("Message timestamp to edit"),
    text: z.string().describe("New message text"),
  },
  async ({ channel, ts, text }) => {
    const result = await slack.chat.update({ channel, ts, text });
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, ts: result.ts }) }],
    };
  }
);

server.tool(
  "slack_delete",
  "Delete a Slack message.",
  {
    channel: z.string().describe("Channel ID"),
    ts: z.string().describe("Message timestamp to delete"),
  },
  async ({ channel, ts }) => {
    await slack.chat.delete({ channel, ts });
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  }
);

server.tool(
  "slack_read",
  "Read recent messages from a Slack channel.",
  {
    channel: z.string().describe("Channel ID"),
    limit: z.number().default(20).describe("Number of messages to fetch (max 100)"),
    oldest: z.string().optional().describe("Only messages after this timestamp"),
  },
  async ({ channel, limit, oldest }) => {
    const result = await slack.conversations.history({
      channel,
      limit: Math.min(limit, 100),
      oldest,
    });
    const messages = (result.messages ?? []).map((m) => ({
      ts: m.ts,
      user: m.user,
      text: m.text,
      thread_ts: m.thread_ts,
      reply_count: m.reply_count,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify({ messages, count: messages.length }, null, 2) }],
    };
  }
);

server.tool(
  "slack_thread",
  "Read replies in a Slack thread.",
  {
    channel: z.string().describe("Channel ID"),
    ts: z.string().describe("Thread parent message timestamp"),
    limit: z.number().default(50).describe("Number of replies to fetch"),
  },
  async ({ channel, ts, limit }) => {
    const result = await slack.conversations.replies({
      channel,
      ts,
      limit: Math.min(limit, 100),
    });
    const messages = (result.messages ?? []).map((m) => ({
      ts: m.ts,
      user: m.user,
      text: m.text,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify({ messages, count: messages.length }, null, 2) }],
    };
  }
);

// ── Reactions ─────────────────────────────────────────────────────────

server.tool(
  "slack_react",
  "Add an emoji reaction to a message.",
  {
    channel: z.string().describe("Channel ID"),
    ts: z.string().describe("Message timestamp"),
    emoji: z.string().describe("Emoji name without colons (e.g., 'thumbsup', 'white_check_mark')"),
  },
  async ({ channel, ts, emoji }) => {
    await slack.reactions.add({ channel, timestamp: ts, name: emoji });
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  }
);

server.tool(
  "slack_reactions_list",
  "List reactions on a message.",
  {
    channel: z.string().describe("Channel ID"),
    ts: z.string().describe("Message timestamp"),
  },
  async ({ channel, ts }) => {
    const result = await slack.reactions.get({ channel, timestamp: ts, full: true });
    const reactions = result.message?.reactions ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify({ reactions }, null, 2) }],
    };
  }
);

// ── Pins ──────────────────────────────────────────────────────────────

server.tool(
  "slack_pin",
  "Pin a message in a channel.",
  {
    channel: z.string().describe("Channel ID"),
    ts: z.string().describe("Message timestamp to pin"),
  },
  async ({ channel, ts }) => {
    await slack.pins.add({ channel, timestamp: ts });
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  }
);

server.tool(
  "slack_unpin",
  "Unpin a message in a channel.",
  {
    channel: z.string().describe("Channel ID"),
    ts: z.string().describe("Message timestamp to unpin"),
  },
  async ({ channel, ts }) => {
    await slack.pins.remove({ channel, timestamp: ts });
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  }
);

server.tool(
  "slack_pins_list",
  "List pinned items in a channel.",
  {
    channel: z.string().describe("Channel ID"),
  },
  async ({ channel }) => {
    const result = await slack.pins.list({ channel });
    const items = (result.items ?? []).map((item) => ({
      type: item.type,
      ts: item.message?.ts,
      text: item.message?.text?.slice(0, 200),
      user: item.message?.user,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify({ pins: items, count: items.length }, null, 2) }],
    };
  }
);

// ── Search ────────────────────────────────────────────────────────────

server.tool(
  "slack_search",
  "Search Slack messages. Requires the 'search:read' scope.",
  {
    query: z.string().describe("Search query (supports Slack search syntax: in:#channel, from:@user, etc.)"),
    count: z.number().default(10).describe("Number of results"),
    sort: z.enum(["score", "timestamp"]).default("score").describe("Sort order"),
  },
  async ({ query, count, sort }) => {
    const result = await slack.search.messages({
      query,
      count: Math.min(count, 50),
      sort,
    });
    const matches = (result.messages?.matches ?? []).map((m) => ({
      ts: m.ts,
      channel: m.channel?.name,
      channelId: m.channel?.id,
      user: m.username,
      text: m.text?.slice(0, 300),
      permalink: m.permalink,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify({ matches, total: result.messages?.total ?? 0 }, null, 2) }],
    };
  }
);

// ── Channels ──────────────────────────────────────────────────────────

server.tool(
  "slack_channels_list",
  "List Slack channels the bot has access to.",
  {
    limit: z.number().default(100).describe("Number of channels to fetch"),
    types: z.string().default("public_channel,private_channel").describe("Channel types to include"),
  },
  async ({ limit, types }) => {
    const result = await slack.conversations.list({
      limit: Math.min(limit, 200),
      types,
    });
    const channels = (result.channels ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      topic: c.topic?.value?.slice(0, 100),
      memberCount: c.num_members,
      isPrivate: c.is_private,
      isArchived: c.is_archived,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify({ channels, count: channels.length }, null, 2) }],
    };
  }
);

server.tool(
  "slack_channel_info",
  "Get detailed info about a specific channel.",
  {
    channel: z.string().describe("Channel ID"),
  },
  async ({ channel }) => {
    const result = await slack.conversations.info({ channel });
    const c = result.channel;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          id: c?.id,
          name: c?.name,
          topic: c?.topic?.value,
          purpose: c?.purpose?.value,
          memberCount: c?.num_members,
          isPrivate: c?.is_private,
          isArchived: c?.is_archived,
          created: c?.created,
        }, null, 2),
      }],
    };
  }
);

// ── Users ─────────────────────────────────────────────────────────────

server.tool(
  "slack_user_info",
  "Get info about a Slack user.",
  {
    user: z.string().describe("User ID (U...)"),
  },
  async ({ user }) => {
    const result = await slack.users.info({ user });
    const u = result.user;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          id: u?.id,
          name: u?.name,
          realName: u?.real_name,
          displayName: u?.profile?.display_name,
          email: u?.profile?.email,
          title: u?.profile?.title,
          isAdmin: u?.is_admin,
          isBot: u?.is_bot,
          timezone: u?.tz,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "slack_users_list",
  "List workspace members.",
  {
    limit: z.number().default(100).describe("Number of users to fetch"),
  },
  async ({ limit }) => {
    const result = await slack.users.list({ limit: Math.min(limit, 200) });
    const users = (result.members ?? [])
      .filter((u) => !u.deleted && !u.is_bot)
      .map((u) => ({
        id: u.id,
        name: u.name,
        realName: u.real_name,
        displayName: u.profile?.display_name,
        isAdmin: u.is_admin,
      }));
    return {
      content: [{ type: "text", text: JSON.stringify({ users, count: users.length }, null, 2) }],
    };
  }
);

// ── Files ─────────────────────────────────────────────────────────────

server.tool(
  "slack_file_upload",
  "Upload a text snippet or file to a Slack channel.",
  {
    channel: z.string().describe("Channel ID to share the file in"),
    content: z.string().describe("File content (text)"),
    filename: z.string().default("snippet.txt").describe("Filename"),
    title: z.string().optional().describe("File title"),
    filetype: z.string().default("text").describe("File type (text, python, javascript, json, csv, etc.)"),
  },
  async ({ channel, content, filename, title, filetype }) => {
    const result = await slack.filesUploadV2({
      channel_id: channel,
      content,
      filename,
      title,
      filetype,
    });
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, fileId: result.file?.id }) }],
    };
  }
);

// ── Set Topic / Purpose ───────────────────────────────────────────────

server.tool(
  "slack_set_topic",
  "Set the topic of a Slack channel.",
  {
    channel: z.string().describe("Channel ID"),
    topic: z.string().describe("New topic text"),
  },
  async ({ channel, topic }) => {
    await slack.conversations.setTopic({ channel, topic });
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
