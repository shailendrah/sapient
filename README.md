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
node frontend/dist/src/cli/index.js start -w workspace
# Open http://127.0.0.1:18789/
# Paste the gateway token shown in terminal
```

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

Edit via the web UI sidebar or directly on disk. Changes take effect on the next agent run.

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

### Twitter Fact-Checking

Reply to any tweet with `@sapient fact check this` and the agent will:
1. Fetch the parent tweet for context
2. Research the claim via WebSearch
3. Reply in-thread with a verdict and sources

Twitter config is open by default (any @mention triggers it). To restrict, add an `allowFrom` list in the channel config. Be aware of API rate limits — free tier allows 1,500 tweets/month.

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

## Requirements

- Node.js >= 20
- pnpm >= 9
- `ANTHROPIC_API_KEY` environment variable
