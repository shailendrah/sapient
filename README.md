# Sapient

Multi-channel AI agent platform — OpenClaw channel frontend + Claude Agent SDK backend.

## Architecture

```
User (Slack/Telegram/WhatsApp/Discord/Twitter/WebChat/iMessage/Google Chat)
  -> Channel Plugin (receives message)
  -> Gateway (auth, routing, session management)
  -> Claude Agent SDK (streaming agent with parallel subagents)
      |- Built-in tools (Read, Write, Bash, Grep, Glob, WebSearch)
      |- MCP tool servers (stdio, HTTP, SSE)
      |- Workspace coaching (SOUL.md, TOOLS.md, AGENTS.md, skills/)
      '- Human-in-the-loop (canUseTool callback)
  -> Gateway (streams events to WebSocket subscribers)
  -> Channel Outbound (sends reply to user)
```

## Workspaces

| Workspace | Purpose |
|-----------|---------|
| `shared/` | Types, protocol definitions, constants |
| `backend/` | Claude Agent SDK integration, agent runtime, workspace coaching |
| `frontend/` | CLI, gateway server, channels, auth, config, web UI |

## Quick Start

### Local

```bash
pnpm install
pnpm -r build
node frontend/dist/src/cli/index.js start
# Open http://127.0.0.1:18789/
# Paste the gateway token shown in terminal
```

Workspace defaults to `~/.sapient/workspace/` and is seeded with default coaching files on first run. Override with `-w /path/to/workspace`.

### Docker

```bash
make start_sapient    # Build and run in foreground
make pair_sapient     # List pending device pairing requests
make pair_sapient DEVICE=device-abc123  # Approve a device
make stop_sapient     # Stop the container
```

Run `make help` for all targets.

## Device Pairing

When a new client connects to the web UI:

1. Enter the gateway token (printed in terminal on startup)
2. UI shows "Device Not Paired" with a device name
3. Admin approves: `make pair_sapient DEVICE=<device-name>`
4. UI auto-detects approval and enables chat

## Agents

Agents are defined in `workspace/AGENTS.md`:

```yaml
---
name: researcher
description: Research agent for web searches
allowedTools: ["WebSearch", "WebFetch", "Read"]
---
You are a research specialist. Search the web and summarize findings.
```

Add more blocks to define additional subagents. The main agent dispatches to them based on the task.

## Workspace Coaching

| File | Purpose |
|------|---------|
| `SOUL.md` | System prompt, personality, instructions |
| `TOOLS.md` | Tool usage guidelines |
| `AGENTS.md` | Subagent definitions (YAML frontmatter) |
| `skills/` | Skill plugins (SKILL.md frontmatter) |

Default location: `~/.sapient/workspace/`. Override with `-w` flag or `agent.workspaceDir` in config. Edit via the web UI sidebar or directly on disk. Changes take effect on the next agent run.

## Configuration

Config file: `~/.sapient/config.json5`

```json5
{
  gateway: {
    port: 18789,
    bind: "loopback",   // "loopback", "lan", or "custom"
    authMode: "token",  // "none", "token", or "password"
  },
  agent: {
    model: "sonnet",    // "sonnet", "opus", "haiku", or full model ID
    permissionMode: "acceptEdits",
  },
  auth: {
    // token is auto-generated if not set
    // password: "secret",  // for password auth mode
  },
}
```

Supports `${ENV_VAR}` substitution and `$secret:name` (reads from `~/.sapient/secrets/<name>`).

## Channels

8 built-in channel plugins:

| Channel | Config key | Transport |
|---------|-----------|-----------|
| WebChat | (built-in) | Gateway WebSocket |
| Slack | `channels.slack` | Socket Mode |
| Telegram | `channels.telegram` | grammy |
| Discord | `channels.discord` | discord.js |
| WhatsApp | `channels.whatsapp` | Baileys |
| Twitter | `channels.twitter` | twitter-api-v2 (mention polling) |
| iMessage | `channels.bluebubbles` | BlueBubbles API |
| Google Chat | `channels.google-chat` | Google API |

Configure channels in `config.json5`. Only WebChat is active by default.

### Slack Setup

1. Go to https://api.slack.com/apps > **Create New App** > **From scratch**
2. Name it (e.g. "Sapient"), pick your workspace
3. Enable **Socket Mode** (left sidebar) — create an App-Level Token with `connections:write` scope. This is your `appToken` (`xapp-...`)
4. Under **OAuth & Permissions**, add Bot Token Scopes:
   - `chat:write` — send messages
   - `im:history` — read DMs
   - `im:read` — view DM channels
   - `app_mentions:read` — see @mentions
5. Under **Event Subscriptions**, enable and subscribe to:
   - `message.im` — DMs to the bot
   - `app_mention` — @mentions in channels
6. **Install to Workspace** — this gives you the Bot Token (`xoxb-...`)

Add to `config.json5`:

```json5
{
  channels: {
    slack: {
      enabled: true,
      botToken: "${SLACK_BOT_TOKEN}",   // xoxb-...
      appToken: "${SLACK_APP_TOKEN}",   // xapp-...
    }
  }
}
```

Start Sapient — you should see `[Slack] Connected (default)` in the logs. DM the bot or @mention it in a channel. The default `dmPolicy: "pairing"` applies: the first message from an unknown user triggers a pairing code. Approve it with:

```bash
make pair_sapient CHANNEL=slack CODE=<code>
```

### WhatsApp Setup

WhatsApp uses QR-based authentication via Baileys (no API keys needed).

1. Add to `config.json5`:

```json5
{
  channels: {
    whatsapp: {
      enabled: true,
    }
  }
}
```

2. Start Sapient — a QR code is printed in the terminal
3. Open WhatsApp on your phone > **Linked Devices** > **Link a Device** > scan the QR code
4. Once connected, you'll see `[WhatsApp] Connected (default)`

Session credentials are stored in `~/.sapient/whatsapp-auth/` and reused on restart (no re-scan needed).

The default `dmPolicy: "pairing"` applies — the first message from an unknown sender triggers a pairing challenge. Approve with:

```bash
make pair_sapient CHANNEL=whatsapp CODE=<code>
```

### Twitter Setup

Twitter uses OAuth 1.0a credentials and polls for @mentions.

1. Go to https://developer.x.com/en/portal/dashboard
2. Create a project and app (or use an existing one)
3. Under **Keys and Tokens**, generate:
   - **API Key and Secret** (Consumer Keys)
   - **Access Token and Secret** (with Read and Write permissions)

Add to `config.json5`:

```json5
{
  channels: {
    twitter: {
      enabled: true,
      appKey: "${TWITTER_APP_KEY}",
      appSecret: "${TWITTER_APP_SECRET}",
      accessToken: "${TWITTER_ACCESS_TOKEN}",
      accessSecret: "${TWITTER_ACCESS_SECRET}",
      pollIntervalMs: 30000,    // optional, default 30s
      maxThreadTweets: 3,       // optional, max reply tweets
    }
  }
}
```

Start Sapient — you should see `[Twitter] Authenticated as @yourbot` and `[Twitter] Polling mentions every 30s`.

### Twitter Fact-Checking

Reply to any tweet with `@sapient fact check this` and the agent will:
1. Fetch the parent tweet for context
2. Research the claim via WebSearch
3. Reply in-thread with a verdict and sources

Twitter config is open by default (any @mention triggers it). To restrict which users can trigger it, add an `allowFrom` list:

```json5
channels: {
  twitter: {
    enabled: true,
    appKey: "...", appSecret: "...",
    accessToken: "...", accessSecret: "...",
    allowFrom: ["trusted_user1", "trusted_user2"],
  }
}
```

Be aware of Twitter API rate limits (subject to current plan limits).

## MCP Servers

Connect external tool servers via the [Model Context Protocol](https://modelcontextprotocol.io/):

```json5
{
  agent: {
    mcpServers: {
      // Local process (stdio)
      "my-tools": {
        command: "node",
        args: ["./mcp-servers/my-tools.js"],
        env: { "API_KEY": "${MY_API_KEY}" }
      },
      // Remote HTTP
      "remote-tools": {
        type: "http",
        url: "https://mcp.example.com/mcp",
        headers: { "Authorization": "Bearer ${MCP_TOKEN}" }
      }
    }
  }
}
```

MCP tools are available alongside built-in tools in all conversations and subagents.

### Oracle Database via SQLcl MCP Server

Oracle 26ai includes a built-in MCP server in SQLcl. This gives the agent direct SQL execution, schema exploration, and vector search — no custom code needed.

```json5
{
  agent: {
    mcpServers: {
      "oracle": {
        command: "sql",
        args: ["-S", "user/pass@//localhost:1521/FREEPDB1", "-mcp"]
      }
    }
  }
}
```

Or with env vars:
```json5
{
  agent: {
    mcpServers: {
      "oracle": {
        command: "sql",
        args: ["-S", "${ORACLE_USER}/${ORACLE_PASSWORD}@${ORACLE_DSN}", "-mcp"]
      }
    }
  }
}
```

This exposes `run-sql`, `run-sqlcl`, and `schema-information` tools to the agent. The `oracle-dba` and `oracle-analyst` subagents use these for structured queries, analytics, and vector similarity search.

## Requirements

- Node.js >= 20
- pnpm >= 9
- `ANTHROPIC_API_KEY` environment variable
