/**
 * Twitter channel plugin — polls for @mentions and replies in-thread.
 *
 * Uses the twitter-api-v2 library (Twitter API v2).
 * Fetches the parent tweet for context when triggered by a mention reply.
 *
 * Config required in config.json5:
 *   channels.twitter: {
 *     enabled: true,
 *     appKey: "...",
 *     appSecret: "...",
 *     accessToken: "...",
 *     accessSecret: "...",
 *     pollIntervalMs: 30000,   // optional, default 30s
 *     maxThreadTweets: 3,      // optional, max reply tweets for long responses
 *   }
 */

import type {
  ChannelPlugin,
  ChannelAccount,
  InboundMessage,
  OutboundMessage,
} from "@sapient/shared";

interface TwitterConfig {
  enabled?: boolean;
  appKey?: string;
  appSecret?: string;
  accessToken?: string;
  accessSecret?: string;
  pollIntervalMs?: number;
  maxThreadTweets?: number;
}

const DEFAULT_POLL_INTERVAL = 30_000;
const MAX_TWEET_LENGTH = 280;
const DEFAULT_MAX_THREAD = 3;

/**
 * Split a long response into tweet-sized chunks for a thread.
 * Tries to break on sentence boundaries.
 */
function splitIntoTweets(text: string, maxTweets: number): string[] {
  if (text.length <= MAX_TWEET_LENGTH) return [text];

  const tweets: string[] = [];
  let remaining = text;

  while (remaining.length > 0 && tweets.length < maxTweets) {
    const isLast = tweets.length === maxTweets - 1;
    const maxLen = MAX_TWEET_LENGTH - (isLast ? 0 : 6); // reserve space for " [n/m]"

    if (remaining.length <= maxLen) {
      tweets.push(remaining);
      break;
    }

    // Try to break at sentence boundary
    let breakAt = -1;
    for (const sep of [". ", "! ", "? ", "\n", "; ", ", "]) {
      const idx = remaining.lastIndexOf(sep, maxLen);
      if (idx > maxLen * 0.4) {
        breakAt = idx + sep.length;
        break;
      }
    }

    // Fall back to word boundary
    if (breakAt === -1) {
      breakAt = remaining.lastIndexOf(" ", maxLen);
      if (breakAt < maxLen * 0.4) breakAt = maxLen;
    }

    tweets.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }

  // Add thread numbering if multiple tweets
  if (tweets.length > 1) {
    return tweets.map((t, i) => `${t} [${i + 1}/${tweets.length}]`);
  }
  return tweets;
}

export const twitterPlugin: ChannelPlugin = {
  id: "twitter",
  meta: {
    id: "twitter",
    label: "Twitter",
    description: "Twitter/X integration — mention-triggered fact-checking with thread replies",
  },
  capabilities: {
    chatTypes: ["channel"],
    reactions: false,
    edit: false,
    reply: true,
    threads: true,
    media: false,
  },
  config: {
    resolveAccounts(config) {
      const tw = config as TwitterConfig;
      if (!tw.appKey || !tw.appSecret || !tw.accessToken || !tw.accessSecret) {
        return [];
      }
      return [
        {
          id: "default",
          label: "Twitter Bot",
          enabled: tw.enabled !== false,
        },
      ];
    },
  },
  lifecycle: {
    async start(account, config, onMessage) {
      const tw = config as TwitterConfig;
      const pollInterval = tw.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;

      // Dynamic import to avoid requiring twitter-api-v2 unless channel is enabled
      const { TwitterApi } = await import("twitter-api-v2");

      const client = new TwitterApi({
        appKey: tw.appKey!,
        appSecret: tw.appSecret!,
        accessToken: tw.accessToken!,
        accessSecret: tw.accessSecret!,
      });

      const readWrite = client.readWrite;

      // Get our own user ID for filtering
      const me = await readWrite.v2.me();
      const myUserId = me.data.id;
      const myUsername = me.data.username;
      console.log(`[Twitter] Authenticated as @${myUsername} (${myUserId})`);

      // Track the most recent mention we've processed
      let sinceId: string | undefined;

      // Seed sinceId with most recent mention to avoid processing old mentions on startup
      try {
        const seed = await readWrite.v2.userMentionTimeline(myUserId, {
          max_results: 5,
        });
        if (seed.data?.meta?.newest_id) {
          sinceId = seed.data.meta.newest_id;
          console.log(`[Twitter] Seeded sinceId: ${sinceId}`);
        }
      } catch (err) {
        console.warn(`[Twitter] Could not seed mentions: ${err}`);
      }

      async function pollMentions() {
        try {
          const mentions = await readWrite.v2.userMentionTimeline(myUserId, {
            since_id: sinceId,
            max_results: 10,
            "tweet.fields": [
              "conversation_id",
              "in_reply_to_user_id",
              "referenced_tweets",
              "author_id",
              "created_at",
              "text",
            ],
            expansions: ["referenced_tweets.id", "author_id"],
          });

          if (!mentions.data?.data?.length) return;

          // Update sinceId to newest
          if (mentions.data.meta?.newest_id) {
            sinceId = mentions.data.meta.newest_id;
          }

          // Build a lookup of included tweets (parent tweets)
          const includedTweets = new Map<string, { text: string; author_id?: string }>();
          if (mentions.data.includes?.tweets) {
            for (const t of mentions.data.includes.tweets) {
              includedTweets.set(t.id, { text: t.text, author_id: t.author_id });
            }
          }

          // Build author lookup
          const authors = new Map<string, string>();
          if (mentions.data.includes?.users) {
            for (const u of mentions.data.includes.users) {
              authors.set(u.id, u.username);
            }
          }

          for (const tweet of mentions.data.data) {
            // Skip our own tweets
            if (tweet.author_id === myUserId) continue;

            // Strip the @mention from the text to get the command
            const command = tweet.text
              .replace(new RegExp(`@${myUsername}\\b`, "gi"), "")
              .trim();

            if (!command) continue;

            // Find the parent tweet (the one being replied to)
            let parentText = "";
            let parentAuthor = "";
            const repliedTo = tweet.referenced_tweets?.find(
              (r) => r.type === "replied_to",
            );

            if (repliedTo) {
              const parent = includedTweets.get(repliedTo.id);
              if (parent) {
                parentText = parent.text;
                parentAuthor = parent.author_id
                  ? `@${authors.get(parent.author_id) ?? parent.author_id}`
                  : "unknown";
              } else {
                // Fetch parent tweet directly if not in includes
                try {
                  const parentTweet = await readWrite.v2.singleTweet(repliedTo.id, {
                    "tweet.fields": ["text", "author_id"],
                    expansions: ["author_id"],
                  });
                  parentText = parentTweet.data.text;
                  const parentUser = parentTweet.includes?.users?.[0];
                  parentAuthor = parentUser ? `@${parentUser.username}` : "unknown";
                } catch {
                  parentText = "[Could not fetch parent tweet]";
                }
              }
            }

            // Build the message text with context
            let messageText = command;
            if (parentText) {
              messageText =
                `[Context — tweet by ${parentAuthor}]: "${parentText}"\n\n` +
                `[User request]: ${command}`;
            }

            const senderUsername =
              authors.get(tweet.author_id ?? "") ?? tweet.author_id ?? "unknown";

            onMessage({
              id: tweet.id,
              channelId: "twitter",
              accountId: account.id,
              from: senderUsername,
              text: messageText,
              chatType: "channel",
              threadId: tweet.conversation_id,
              replyToId: repliedTo?.id,
              timestamp: tweet.created_at
                ? new Date(tweet.created_at).getTime()
                : Date.now(),
              raw: {
                tweetId: tweet.id,
                conversationId: tweet.conversation_id,
                authorId: tweet.author_id,
                parentText,
                parentAuthor,
              },
            });
          }
        } catch (err: any) {
          // Handle rate limiting gracefully
          if (err?.code === 429 || err?.rateLimitError) {
            const resetAt = err?.rateLimit?.reset;
            if (resetAt) {
              const waitMs = resetAt * 1000 - Date.now();
              console.warn(
                `[Twitter] Rate limited. Reset in ${Math.ceil(waitMs / 1000)}s`,
              );
            } else {
              console.warn("[Twitter] Rate limited. Will retry next poll.");
            }
          } else {
            console.error(`[Twitter] Poll error: ${err?.message ?? err}`);
          }
        }
      }

      // Start polling
      const timer = setInterval(pollMentions, pollInterval);
      // Run first poll immediately
      await pollMentions();

      console.log(
        `[Twitter] Polling mentions every ${pollInterval / 1000}s (${account.id})`,
      );

      // Store references for cleanup
      (account as any)._client = readWrite;
      (account as any)._timer = timer;
      (account as any)._config = tw;
    },

    async stop(account) {
      const timer = (account as any)._timer;
      if (timer) {
        clearInterval(timer);
        console.log(`[Twitter] Stopped polling (${account.id})`);
      }
    },
  },

  outbound: {
    async send(account, to, message) {
      const client = (account as any)._client;
      if (!client) throw new Error("Twitter not connected");

      const tw = (account as any)._config as TwitterConfig;
      const maxThread = tw.maxThreadTweets ?? DEFAULT_MAX_THREAD;
      const text = message.text ?? "";

      // Split into tweet-sized chunks
      const tweets = splitIntoTweets(text, maxThread);

      // Post as a thread, replying to the original tweet (to = tweetId)
      let lastTweetId = to;

      for (const tweetText of tweets) {
        const result = await client.v2.reply(tweetText, lastTweetId);
        lastTweetId = result.data.id;
      }

      return { messageId: lastTweetId };
    },
  },

  security: {
    isAllowed: () => true,
    dmPolicy: "open",
  },
};

export default twitterPlugin;
