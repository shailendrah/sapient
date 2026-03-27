# Sapient — Architecture Notes

**Date:** 2026-03-26
**Status:** Step 2 — architecture decision reached

---

## Project Vision (REVISED)

Sapient = **OpenClaw channel frontend** + **Claude Agent SDK backend**

Strip OpenClaw down to its channel/gateway/auth infrastructure. Replace the Pi SDK agent runtime with the Claude Agent SDK, which natively provides parallel subagents and human-in-the-loop. No Python, no LangGraph, no bridges.

**Flow:**
```
User (Slack/Telegram/WhatsApp/etc.)
  → OpenClaw Channel Plugin (receives message)
  → OpenClaw Gateway (auth, routing, session)
  → Claude Agent SDK (replaces Pi SDK)
      ├─ Native parallel subagents (fan-out/fan-in)
      ├─ Native human-in-the-loop (canUseTool callback)
      ├─ Built-in tools (Read, Write, Bash, Grep, Glob, WebSearch)
      ├─ Custom tools (your own business logic)
      └─ Hooks system (PreToolUse, PostToolUse, SubagentStart/Stop)
  → OpenClaw Gateway (streams results to subscribers)
  → Channel Outbound Adapter (sends reply to user)
```

**Key principle:** OpenClaw's value is the channel layer. The backend agent logic is ours.

---

## Architecture Evolution (How We Got Here)

### Original idea: OpenClaw frontend + LangGraph backend
- Bridge OpenClaw (TypeScript) to CognitiveGraph (Python/FastAPI/LangGraph)
- LLM generates LangGraph code, execution engine runs it
- **Problem:** Bridges are fragile. Two languages, two streaming systems, two auth systems.

### Discovery 1: OpenClaw already has parallel agents + human-in-the-loop
- `subagent-spawn.ts` / `subagent-registry.ts` — parallel subagent execution (up to 5 concurrent)
- `exec-approvals.ts` — two-phase tool approval system
- `sessions-yield-tool.ts` — yield/resume for subagent coordination
- All implemented at OpenClaw's application layer, NOT in the Pi SDK

### Discovery 2: OpenClaw is NOT locked to Claude
- Pi SDK is provider-agnostic (Anthropic, OpenAI, Google, Bedrock, Ollama, vLLM)
- Model configured in `agents.defaults.model.primary`
- Supports fallback chains

### Discovery 3: Claude Agent SDK provides everything natively
- `claude-agent-sdk` on PyPI / `@anthropic-ai/claude-agent-sdk` on npm
- Native parallel subagents (define agents, orchestrator dispatches concurrently)
- Native human-in-the-loop (`canUseTool` callback, `permission_mode`)
- Hooks system (PreToolUse, PostToolUse, SubagentStart/Stop, PermissionRequest)
- Built-in tools (Read, Write, Edit, Bash, Grep, Glob, WebSearch)
- This is what powers Claude Code itself

### Decision: Replace Pi SDK with Claude Agent SDK
- No Python needed, no LangGraph, no bridges
- Keep OpenClaw's channel/gateway/auth (the real value)
- Own the backend agent logic
- Trade-off: Claude-only for now (multi-provider is a future problem)

---

## Revised Plan

1. ~~Rename digiclaw → sapient~~ (DONE)
2. ~~Discuss architecture~~ (DONE — Claude Agent SDK backend decided)
3. **Extract OpenClaw channel layer** — gateway, channels, auth, config, streaming, CLI
4. **Replace Pi SDK with Claude Agent SDK** — agent runtime, tools, subagents, human-in-the-loop
5. **Build custom agent logic** — task decomposition, tool definitions, orchestration patterns
6. Integration testing
7. Dockerization
8. Test

---

## Source Repositories

- **OpenClaw:** `../openclaw` — TypeScript/Node.js monorepo, pnpm workspaces, ~78+ subdirs
- **CognitiveGraph:** `../agenticai/cognitivegraph` — Python FastAPI + LangGraph backend (NO LONGER NEEDED for core architecture, may reference for ideas)

---

## OpenClaw Codebase Summary

TypeScript/Node.js monorepo with pnpm workspaces.

### Key Components

| Component | Location | Description |
|-----------|----------|-------------|
| Gateway | `src/gateway/` | WebSocket control plane, ~100+ RPC methods, auth, routing, streaming, presence |
| Channel Plugins | `extensions/` | 75+ channel adapters (Slack, Discord, Telegram, WhatsApp, Signal, iMessage, Teams, Matrix, etc.) |
| Channel Core | `src/channels/` | Plugin loading, adapter pattern types, allowlists, mention gating, typing indicators |
| Auth & Pairing | `src/pairing/`, `src/security/`, `src/gateway/auth*.ts` | DM pairing codes, device auth (RSA), allowlists, rate limiting |
| Agent Runtime | `src/agents/pi-embedded-*` | Pi SDK — **TO BE REPLACED with Claude Agent SDK** |
| Streaming | `src/gateway/server-chat.ts` | Real-time event broadcast — text blocks, tool calls, reasoning |
| Config | `src/config/` | JSON5 + Zod schemas + secrets management |
| Workspace | `src/agents/workspace.ts` | AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md per agent |
| Skills | `src/agents/skills/` | Tarball-based skill registry (bundled + managed + workspace) |
| Plugin SDK | `src/plugin-sdk/` | 30+ exported subpaths for extension development |
| Web UI | `ui/` | React/Vite control panel + WebChat |
| Canvas/A2UI | `src/canvas-host/` | Visual workspace rendering |
| Subagent System | `src/agents/subagent-*.ts` | Parallel subagent spawning/registry — **MAY BE REPLACED by SDK native** |
| Approval System | `src/infra/exec-approvals.ts` | Two-phase tool approval — **MAY BE REPLACED by SDK canUseTool** |

### Channel Plugin Architecture

Each channel implements optional adapters:
- **Config** — schema, validation, mutation
- **Setup** — interactive setup flow (OAuth, webhooks)
- **Pairing** — DM allowlist challenges and approval
- **Security** — allowlist matching, group policies
- **Lifecycle** — startup/shutdown hooks, reconnection
- **Outbound** — send messages, files, reactions
- **Messaging** — receive messages, threading, edits
- **Streaming** — channel-specific streaming behavior
- **Gateway** — channel-specific RPC methods

### What OpenClaw Does with LLMs

OpenClaw does **NOT** generate code. It uses an LLM as a conversational agent with tools (ReAct loop):
1. User sends message → LLM receives it with system prompt + available tools
2. LLM reasons and decides which tools to call (browser, bash, skills, etc.)
3. Tool results stream back → LLM reasons again → more tools or final text response

The Pi SDK is provider-agnostic (Anthropic, OpenAI, Google, Bedrock, Ollama, vLLM).

---

## Claude Agent SDK — The New Backend

### What It Provides

| Feature | Mechanism |
|---------|-----------|
| Agent loop | Wraps Claude Code's agent runtime |
| Parallel subagents | `agents` parameter on ClaudeAgentOptions, dispatched via `Agent` tool |
| Human-in-the-loop | `canUseTool` callback + `permission_mode` (default/acceptEdits/bypassPermissions) |
| Built-in tools | Read, Write, Edit, Bash, Grep, Glob, WebSearch |
| Custom tools | Python functions run as in-process MCP servers |
| MCP integration | Connect external MCP tool servers |
| Hooks | PreToolUse, PostToolUse, Stop, SubagentStart/Stop, PermissionRequest, Notification, PreCompact, UserPromptSubmit |
| Streaming | `query()` returns AsyncIterator of messages |

### Available on Both Platforms
- **Python:** `claude-agent-sdk` on PyPI, import as `claude_agent_sdk`
- **Node.js/TypeScript:** `@anthropic-ai/claude-agent-sdk` on npm

### Key Limitation
- **Claude-only** — does not support other LLM providers
- Multi-provider support is a future consideration

### Related: Claude Code Agent Teams (Experimental)
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- One session as team lead, spawns teammates
- Shared task list with dependency tracking
- Inter-agent messaging
- Still experimental

---

## What to Keep from OpenClaw

### KEEP (Channel/Infra Layer)

1. **Gateway + WebSocket Server** (`src/gateway/`) — adapt agent invocation to call Claude Agent SDK instead of Pi SDK
2. **All 75+ Channel Plugins** (`extensions/`) — as-is
3. **Channel Core** (`src/channels/`) — plugin loading, adapter types, allowlists, mention gating
4. **Auth & Pairing** (`src/pairing/`, `src/security/`, `src/gateway/auth*.ts`)
5. **Streaming Infrastructure** (`src/gateway/server-chat.ts`) — adapt to stream Claude Agent SDK events
6. **Config System** (`src/config/`) — extend with Claude Agent SDK settings
7. **CLI** (`src/cli/`) — keep as-is, users are familiar with it
8. **Workspace Model** — AGENTS.md/SOUL.md/TOOLS.md for agent coaching
9. **Plugin SDK** (`src/plugin-sdk/`) — extension architecture
10. **Web UI** (`ui/`) — control panel + WebChat

### REPLACE

| OpenClaw Component | Replaced By |
|-------------------|-------------|
| Pi SDK agent runtime (`src/agents/pi-embedded-*`) | Claude Agent SDK agent loop |
| Pi-specific tools (`src/agents/pi-tools*.ts`) | Claude Agent SDK built-in tools + custom tools |
| Subagent spawning (`src/agents/subagent-*.ts`) | Claude Agent SDK native subagents |
| Exec approvals (`src/infra/exec-approvals.ts`) | Claude Agent SDK `canUseTool` callback |
| Model catalog/failover (`src/agents/model-*.ts`) | Claude Agent SDK (Claude-only for now) |
| Context compaction (`src/agents/compaction*.ts`) | Claude Agent SDK handles internally |

### DROP (Out of Scope)

- Companion apps (`Swabble/`, `apps/`) — not needed initially
- CognitiveGraph/LangGraph — not needed for core architecture

---

## CognitiveGraph Summary (For Reference Only)

Python FastAPI app with LangGraph. No longer part of core architecture, but may reference for ideas around:
- Vector memory patterns (FAISS, Chroma, pgvector)
- Execution metrics/observability patterns
- Tool registry patterns

Key deps: langgraph, langchain, fastapi, uvicorn, pydantic, sqlalchemy

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Project name | Sapient | Captures intelligence + multi-channel reach |
| Backend | Claude Agent SDK | Native parallel agents, human-in-the-loop. No bridges needed |
| LangGraph | Not needed | OpenClaw + Claude Agent SDK cover the use cases (parallel agents, human-in-the-loop) |
| Language | TypeScript only | No Python backend, no bridge fragility. Outbound calls go directly to Claude API — no server needed |
| Claude Agent SDK | TypeScript (npm) | `@anthropic-ai/claude-agent-sdk` — integrates directly into OpenClaw codebase |
| CLI | Keep OpenClaw CLI | Users are familiar with it |
| Multi-provider | Future consideration | Claude Agent SDK is Claude-only; channel layer is provider-agnostic |
| CognitiveGraph | Reference only | May borrow ideas but not code |

---

## Open Questions

1. **Multi-provider strategy** — Claude Agent SDK is Claude-only. How/when to support other providers?
2. ~~**Claude Agent SDK: Python or TypeScript?**~~ — **DECIDED: TypeScript.** No client-server architecture needed. Outbound calls go directly to Claude's API. The npm package (`@anthropic-ai/claude-agent-sdk`) integrates directly into OpenClaw's TypeScript codebase.
3. **Workspace coaching** — How to adapt AGENTS.md/SOUL.md/TOOLS.md for Claude Agent SDK's system prompts and tool definitions?
4. **Streaming translation** — How to map Claude Agent SDK's AsyncIterator output to OpenClaw's existing streaming event format?

---

## Use Cases That Drove the Architecture

### Use Case A: Human-in-the-Loop (Vacation Planning)
- Agent plans vacation → presents options A vs B → pauses → waits for choice → continues
- Claude Agent SDK: `canUseTool` callback pauses at approval points, full state preserved
- Better than conversational back-and-forth which loses internal state between turns

### Use Case B: Parallel Agent Forking (Large Codebase Analysis)
- Break large task into subtasks → spawn multiple agents → each reads a portion → synthesizer combines
- Claude Agent SDK: native subagents run concurrently, orchestrator collects results
- Fan-out/fan-in pattern without any graph framework

---

## Project Structure

```
sapient/
├── frontend/                    # OpenClaw channel layer (stripped down)
│   ├── src/
│   │   ├── gateway/             # WebSocket server, RPC, streaming
│   │   ├── channels/            # Channel core + plugin loading
│   │   ├── auth/                # Pairing, allowlists, device auth
│   │   ├── config/              # JSON5 + Zod config (simplified)
│   │   ├── streaming/           # Event broadcast to clients
│   │   └── cli/                 # CLI commands
│   ├── extensions/              # 7 core channels (not 75)
│   │   ├── slack/
│   │   ├── telegram/
│   │   ├── discord/
│   │   ├── whatsapp/
│   │   ├── webchat/
│   │   ├── bluebubbles/         # iMessage
│   │   └── google-chat/
│   ├── ui/                      # React/Vite web UI
│   ├── package.json
│   └── tsconfig.json
│
├── backend/                     # Claude Agent SDK integration
│   ├── src/
│   │   ├── agent/               # Main agent setup + Claude Agent SDK wiring
│   │   ├── subagents/           # Subagent definitions (parallel workers)
│   │   ├── tools/               # Custom tool definitions
│   │   ├── hooks/               # PreToolUse, PostToolUse, permissions
│   │   └── workspace/           # AGENTS.md, SOUL.md, TOOLS.md coaching
│   ├── package.json
│   └── tsconfig.json
│
├── shared/                      # Types, utils shared between frontend/backend
│   ├── src/
│   │   ├── types/               # Message types, streaming events, config schemas
│   │   └── utils/               # Common utilities
│   ├── package.json
│   └── tsconfig.json
│
├── docs/
│   └── notes.md
├── docker-compose.yml           # Single compose file
├── Dockerfile                   # Single, simple Dockerfile
├── package.json                 # Root workspace (pnpm, 3 workspaces only)
├── pnpm-workspace.yaml
└── tsconfig.json
```

### Simplifications vs OpenClaw

| OpenClaw | Sapient |
|----------|---------------|
| 81 workspaces | 3 workspaces (frontend, backend, shared) |
| 75 extensions as separate workspaces | 7 channels in frontend/extensions/, not separate workspaces |
| 11 native dependencies | Zero native deps initially |
| 10+ chained post-build scripts | Single tsdown/esbuild build per workspace |
| dist-runtime overlay system | Simple dist/ output |
| Plugin SDK with 15 subpath exports | Simple shared types package |
| Build-time extension scanning | Runtime plugin discovery at startup |
| Node ≥22.16, pnpm 10.23 pinned | Node ≥20 LTS, pnpm ≥9 |
| 1.2GB node_modules | Target <200MB |

### Core Channels (7)

1. **Slack** — enterprise
2. **Telegram** — personal/bots
3. **Discord** — community
4. **WhatsApp** — global reach
5. **WebChat** — built-in, always works
6. **iMessage** (BlueBubbles) — Apple users
7. **Google Chat** — Google Workspace

Others (Signal, Teams, Matrix, etc.) can be added later as drop-in extensions.

---

## Next Steps

1. Extract OpenClaw channel layer into sapient/frontend/
2. Wire up Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) in sapient/backend/
3. Build custom tools and orchestration patterns
4. Integration testing across 7 channels
5. Dockerize
6. Full test suite
