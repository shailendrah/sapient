/**
 * Core message types — the normalized format that channels produce and consume.
 */

export type ChatType = "direct" | "group" | "channel";

/** Inbound message from any channel, normalized to a common format. */
export interface InboundMessage {
  /** Unique message ID from the originating channel. */
  id: string;
  /** Channel that produced this message (e.g., "slack", "telegram"). */
  channelId: string;
  /** Account ID within the channel (for multi-account channels). */
  accountId?: string;
  /** Sender identifier (channel-specific format). */
  from: string;
  /** Display name of the sender. */
  fromDisplayName?: string;
  /** Recipient identifier. */
  to?: string;
  /** Message text content. */
  text: string;
  /** Chat type context. */
  chatType: ChatType;
  /** Group/channel ID if applicable. */
  groupId?: string;
  /** Thread ID for threaded conversations. */
  threadId?: string;
  /** ID of message being replied to. */
  replyToId?: string;
  /** Media attachments. */
  media?: MediaAttachment[];
  /** Timestamp (ms since epoch). */
  timestamp: number;
  /** Raw channel-specific data for passthrough. */
  raw?: Record<string, unknown>;
}

export interface MediaAttachment {
  url: string;
  mimeType?: string;
  filename?: string;
  size?: number;
}

/** Outbound reply to be sent back through a channel. */
export interface OutboundMessage {
  /** Message text. */
  text?: string;
  /** Media URLs to attach. */
  mediaUrls?: string[];
  /** Reply to a specific message ID. */
  replyToId?: string;
  /** Whether this is an error message. */
  isError?: boolean;
  /** Channel-specific data for passthrough. */
  channelData?: Record<string, unknown>;
}
