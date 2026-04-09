---
name: slack
description: Full Slack workspace control via MCP tools. Use when users want to send messages, react, pin, search, manage channels, upload files, or look up users in Slack. Goes beyond the channel plugin (which handles inbound messages) to give proactive Slack control.
metadata:
  openclaw:
    emoji: "💬"
    requires:
      env: ["SLACK_BOT_TOKEN"]
---
# Slack MCP Tools

Full Slack API access for proactive workspace control. The Slack channel plugin handles inbound messages — these tools handle everything else.

## Available Tools

### Messaging
| Tool | Purpose |
|------|---------|
| `slack_send` | Send a message to a channel or user (supports threads) |
| `slack_edit` | Edit an existing message |
| `slack_delete` | Delete a message |
| `slack_read` | Read recent messages from a channel |
| `slack_thread` | Read replies in a thread |

### Reactions & Pins
| Tool | Purpose |
|------|---------|
| `slack_react` | Add an emoji reaction |
| `slack_reactions_list` | List reactions on a message |
| `slack_pin` | Pin a message |
| `slack_unpin` | Unpin a message |
| `slack_pins_list` | List pinned items in a channel |

### Search & Discovery
| Tool | Purpose |
|------|---------|
| `slack_search` | Search messages (supports `in:#channel`, `from:@user`) |
| `slack_channels_list` | List accessible channels |
| `slack_channel_info` | Get channel details (topic, purpose, members) |
| `slack_users_list` | List workspace members |
| `slack_user_info` | Get user details (name, email, title, timezone) |

### Files & Settings
| Tool | Purpose |
|------|---------|
| `slack_file_upload` | Upload text/code snippets to a channel |
| `slack_set_topic` | Set a channel's topic |

## Required Bot Token Scopes

The bot token (`xoxb-...`) needs these scopes:
- `chat:write` — send/edit/delete messages
- `channels:history`, `groups:history`, `im:history` — read messages
- `reactions:write`, `reactions:read` — manage reactions
- `pins:write`, `pins:read` — manage pins
- `search:read` — search messages
- `channels:read`, `groups:read` — list channels
- `users:read`, `users:read.email` — user info
- `files:write` — upload files

## Example Prompts

- "Send a message to #general saying the deploy is complete"
- "React with a checkmark to the last message in #alerts"
- "Pin the weekly status in #engineering"
- "Search Slack for messages about the database migration"
- "Who posted in #incidents in the last hour?"
- "Upload this CSV data to #analytics"
- "List all channels I have access to"
- "What's the topic of #engineering?"
