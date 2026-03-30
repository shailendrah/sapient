# Sapient

Multi-channel AI agent platform with adaptive knowledge retrieval.

Sapient combines a multi-channel frontend (derived from OpenClaw) with a Claude Agent SDK backend, Oracle AI Vector Search, and an adaptive retrieval system that automatically selects the best knowledge source for each query.

## What Makes Sapient Different

| Capability | OpenClaw | Sapient |
|-----------|----------|---------|
| LLM Backend | Pi SDK (multi-provider) | Claude Agent SDK (native subagents, streaming) |
| Knowledge Retrieval | WebSearch only | Adaptive: vector search + WebSearch, compares and picks the best |
| Database | None | Oracle 26ai via SQLcl MCP server (SQL + vector search) |
| Embeddings | None | Local embedding server (transformers.js, no external API) |
| Tool Integration | Built-in tools | Built-in tools + MCP servers (stdio, HTTP, SSE) |
| Fact-Checking | None | Twitter mention-triggered with source citations |
| Auth | Token only | Token + password + device pairing |

### Adaptive Knowledge Retrieval

When answering questions, Sapient's `knowledge-retriever` subagent:

1. **Detects available sources** — vector search, web search, local files
2. **Queries all available sources in parallel** — vector similarity search against your knowledge base, WebSearch for live information
3. **Compares results** — scores vector results by cosine distance, web results by relevance and authority
4. **Picks the best** — recommends which source answered the question better

If vector search is not configured, the retriever falls back to WebSearch and local files — equivalent to OpenClaw's behavior but with the same unified interface.

## Architecture

```
User (Slack/Telegram/WhatsApp/Discord/Twitter/WebChat/iMessage/Google Chat)
  -> Channel Plugin (receives message)
  -> Gateway (auth, device pairing, routing, session management)
  -> Claude Agent SDK (streaming agent with parallel subagents)
      |- Built-in tools (Read, Write, Bash, Grep, Glob, WebSearch)
      |- MCP servers (Oracle SQLcl, embedding, custom)
      |- knowledge-retriever (adaptive: vector search vs WebSearch)
      |- Workspace coaching (SOUL.md, TOOLS.md, AGENTS.md, skills/)
      '- Human-in-the-loop (canUseTool callback)
  -> Gateway (streams events to WebSocket subscribers)
  -> Channel Outbound (sends reply to user)
```

## Subagents

| Agent | Purpose | Tools |
|-------|---------|-------|
| `knowledge-retriever` | Parallel retrieval from vector DB + web, compares and ranks | embed, run-sql, WebSearch, Read, Grep |
| `researcher` | Web search and information gathering | WebSearch, WebFetch, Read |
| `coder` | Code reading, writing, editing | Read, Write, Edit, Bash, Grep, Glob |
| `analyst` | Data file analysis | Read, Bash, Grep |
| `oracle-dba` | Schema exploration, SQL queries, vector search | run-sql, run-sqlcl, schema-information, embed |
| `oracle-analyst` | Analytics, window functions, pivots, time-series | run-sql, run-sqlcl, schema-information, embed |

All agents are defined in `workspace/AGENTS.md` and can be customized or extended.

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
    mcpServers: {
      // Oracle database (optional)
      "oracle": { command: "sql", args: ["-mcp"] },
      // Local embeddings for vector search (optional)
      "embed": {
        command: "node",
        args: ["mcp-servers/embed/index.js"],
        env: { "EMBED_MODEL": "Xenova/all-MiniLM-L6-v2" }
      },
    },
  },
  auth: {
    // token is auto-generated if not set
    // password: "secret",  // for password auth mode
  },
}
```

Supports `${ENV_VAR}` substitution and `$secret:name` (reads from `~/.sapient/secrets/<name>`).

### Minimal Config (no vector search)

Without MCP servers configured, Sapient works like OpenClaw — WebSearch, file tools, and the Claude agent. No database or embedding setup needed.

```json5
{
  agent: { model: "sonnet" },
}
```

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

#### Twitter Fact-Checking

Reply to any tweet with `@sapient fact check this` and the agent will:
1. Fetch the parent tweet for context
2. Research the claim via WebSearch (and vector search if configured)
3. Reply in-thread with a verdict and sources

To restrict which users can trigger it, add an `allowFrom` list:

```json5
channels: {
  twitter: {
    // ...credentials...
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
        args: ["-mcp"]
      }
    }
  }
}
```

The MCP server starts without a connection. The agent connects on first use via `run-sqlcl` with `connect user/pass@//host:port/service`. This exposes `run-sql`, `run-sqlcl`, `schema-information`, `connect`, and `disconnect` tools.

### Embedding Server for Vector Search

A bundled MCP server provides text-to-vector embedding for similarity search:

```json5
{
  agent: {
    mcpServers: {
      "embed": {
        command: "node",
        args: ["mcp-servers/embed/index.js"],
        env: { "EMBED_MODEL": "Xenova/all-MiniLM-L6-v2" }
      }
    }
  }
}
```

Tools provided:
- `embed` — convert text to an Oracle-compatible vector string for `TO_VECTOR()` / `VECTOR_DISTANCE()`
- `embed_batch` — batch embedding for multiple texts
- `embed_info` — model metadata (dimensions, format)

Runs locally via transformers.js. No external API calls. Works with any Oracle table that has a `VECTOR` column — the agent discovers them automatically.

## Adaptive RAG Pipeline

When both Oracle and embedding MCP servers are configured, the `knowledge-retriever` subagent enables an adaptive retrieval pipeline:

```
User question
  -> knowledge-retriever (parallel)
      |-> Vector path: embed(question) -> VECTOR_DISTANCE() query -> ranked docs
      |-> Web path:    WebSearch(question) -> ranked web results
      '-> Compare: cosine distance vs web relevance -> pick best source
  -> Main agent reasons over the best available context
```

| Scenario | What happens |
|----------|-------------|
| Vector + Web configured | Both run in parallel, best result wins |
| Web only (no vector DB) | WebSearch only — equivalent to OpenClaw |
| Vector only (no web) | Vector search only |
| Neither | Agent uses its training knowledge |

The agent never assumes vector search is available. It checks its tools and adapts.

## Workspace Coaching

| File | Purpose |
|------|---------|
| `SOUL.md` | System prompt, personality, retrieval strategy |
| `TOOLS.md` | Tool usage guidelines |
| `AGENTS.md` | Subagent definitions (YAML frontmatter) |
| `skills/` | Skill plugins (SKILL.md frontmatter) |

Default location: `~/.sapient/workspace/`. Override with `-w` flag or `agent.workspaceDir` in config. Edit via the web UI sidebar or directly on disk. Changes take effect on the next agent run.

## Project Structure

```
sapient/
  shared/               # Types, protocol definitions, constants
  backend/              # Claude Agent SDK integration, agent runtime
  frontend/             # CLI, gateway, channels, auth, config, web UI
    extensions/         # Channel plugins (slack, telegram, discord, etc.)
    ui/                 # Web UI (login, chat, pairing, workspace editor)
  mcp-servers/
    embed/              # Local embedding MCP server (transformers.js)
  workspace/            # Default workspace (SOUL.md, AGENTS.md, skills/)
  Makefile              # Docker targets (start, stop, pair, logs)
  Dockerfile
  docker-compose.yml
```

## Requirements

- Node.js >= 20
- pnpm >= 9
- `ANTHROPIC_API_KEY` environment variable
- Oracle 26ai + SQLcl (optional, for database and vector search)
