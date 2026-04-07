/**
 * Gateway RPC method handlers.
 */

import {
  DEFAULT_MODEL,
  type InboundMessage,
  type StreamEvent,
  type SapientConfig,
  type Session,
} from "@sapient/shared";
import fs from "node:fs";
import path from "node:path";
import { runAgent } from "@sapient/backend";
import type { GatewayClient, RequestHandler } from "./server.js";
import { ChannelRegistry } from "../channels/registry.js";
import { loadConfig, patchConfig } from "../config/loader.js";
import {
  approvePairingCode,
  loadPending,
  loadPendingDevices,
  approveDevice,
  isDevicePaired,
} from "../auth/pairing.js";

/** Runtime state shared across all method handlers. */
export interface GatewayContext {
  config: SapientConfig;
  channels: ChannelRegistry;
  sessions: Map<string, Session>;
  abortControllers: Map<string, AbortController>;
  /** Maps runId → sessionKey for session-scoped abort. */
  runSessions: Map<string, string>;
  broadcastToSession: (sessionKey: string, event: StreamEvent) => void;
  workspaceDir?: string;
}

const WORKSPACE_FILES = [
  "SOUL.md",
  "TOOLS.md",
  "AGENTS.md",
  "IDENTITY.md",
  "USER.md",
];

/** Create all RPC method handlers. */
export function createMethods(ctx: GatewayContext): Map<string, RequestHandler> {
  const methods = new Map<string, RequestHandler>();

  // ── Chat ──────────────────────────────────────────────────────────

  methods.set("chat.send", async (client, params) => {
    // Check device pairing — re-check in case it was approved since connection
    if (!client.paired && client.deviceName) {
      client.paired = isDevicePaired(client.deviceName);
    }
    if (!client.paired) {
      return {
        ok: false,
        error: "DEVICE_NOT_PAIRED",
        message: `Device not paired. Ask admin to run: make pair_sapient DEVICE=${client.deviceName}`,
        deviceName: client.deviceName,
      };
    }

    const { sessionKey, message } = params as {
      sessionKey?: string;
      message: string;
    };
    const key = sessionKey ?? "main";
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Create or update session
    let session = ctx.sessions.get(key);
    if (!session) {
      session = {
        id: runId,
        key,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "active",
      };
      ctx.sessions.set(key, session);
    }
    session.updatedAt = Date.now();
    session.status = "active";

    // Create abort controller and track session mapping
    const abortController = new AbortController();
    ctx.abortControllers.set(runId, abortController);
    ctx.runSessions.set(runId, key);

    // Build inbound message
    const inbound: InboundMessage = {
      id: runId,
      channelId: "webchat",
      from: client.id,
      text: message,
      chatType: "direct",
      timestamp: Date.now(),
    };

    // Subscribe this client to the session
    client.subscribedSessions.add(key);

    // Run agent asynchronously
    runAgent(inbound, key, {
      runId,
      config: ctx.config.agent ?? { model: DEFAULT_MODEL },
      abortController,
      onStreamEvent(event: StreamEvent) {
        ctx.broadcastToSession(key, event);
      },
    })
      .catch((err) => {
        console.error(`[chat.send] Agent error: ${err}`);
      })
      .finally(() => {
        ctx.abortControllers.delete(runId);
        ctx.runSessions.delete(runId);
      });

    return { runId, status: "started" };
  });

  methods.set("chat.abort", async (_client, params) => {
    const { runId, sessionKey } = params as {
      runId?: string;
      sessionKey?: string;
    };

    if (runId) {
      const controller = ctx.abortControllers.get(runId);
      if (controller) {
        controller.abort();
        ctx.abortControllers.delete(runId);
        return { ok: true, aborted: true };
      }
      return { ok: true, aborted: false };
    }

    // Abort only runs belonging to this session
    if (sessionKey) {
      let count = 0;
      for (const [id, mappedSession] of ctx.runSessions) {
        if (mappedSession === sessionKey) {
          const controller = ctx.abortControllers.get(id);
          if (controller) {
            controller.abort();
            ctx.abortControllers.delete(id);
          }
          ctx.runSessions.delete(id);
          count++;
        }
      }
      return { ok: true, aborted: count > 0, count };
    }

    return { ok: false, error: "Provide runId or sessionKey" };
  });

  // ── Sessions ──────────────────────────────────────────────────────

  methods.set("sessions.list", async () => {
    const sessions = Array.from(ctx.sessions.values()).map((s) => ({
      key: s.key,
      id: s.id,
      channelId: s.channelId,
      from: s.from,
      status: s.status,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
    return { sessions };
  });

  // ── Channels ──────────────────────────────────────────────────────

  methods.set("channels.list", async () => {
    const channels = ctx.channels.list().map((ch) => ({
      id: ch.plugin.id,
      label: ch.plugin.meta.label,
      status: ch.status,
      error: ch.error,
      capabilities: ch.plugin.capabilities,
      accounts: Array.from(ch.activeAccounts.values()),
    }));
    return { channels };
  });

  methods.set("channels.status", async () => {
    const channels = ctx.channels.list().map((ch) => ({
      id: ch.plugin.id,
      label: ch.plugin.meta.label,
      status: ch.status,
      error: ch.error,
      accountCount: ch.activeAccounts.size,
    }));
    return { channels };
  });

  // ── Config ────────────────────────────────────────────────────────

  methods.set("config.get", async () => {
    const config = loadConfig();
    // Redact sensitive values
    const redacted = { ...config };
    if (redacted.agent?.apiKey) {
      redacted.agent = { ...redacted.agent, apiKey: "***" };
    }
    if (redacted.agent?.mcpServers) {
      // Redact headers (may contain auth tokens) and env (may contain secrets)
      const redactedServers: Record<string, unknown> = {};
      for (const [name, spec] of Object.entries(redacted.agent.mcpServers)) {
        const s = { ...spec } as Record<string, unknown>;
        if ("headers" in s) s.headers = "***";
        if ("env" in s) s.env = "***";
        redactedServers[name] = s;
      }
      redacted.agent = { ...redacted.agent, mcpServers: redactedServers as any };
    }
    if (redacted.auth?.token) {
      redacted.auth = { ...redacted.auth, token: "***" };
    }
    if (redacted.auth?.password) {
      redacted.auth = { ...redacted.auth, password: "***" };
    }
    return { config: redacted };
  });

  methods.set("config.patch", async (_client, params) => {
    const { patch } = params as { patch: Partial<SapientConfig> };
    const merged = patchConfig(patch);
    // Reload into context
    ctx.config = merged;
    return { ok: true };
  });

  methods.set("config.setModel", async (_client, params) => {
    const { provider, model, providerApiKey } = params as {
      provider?: string;
      model: string;
      providerApiKey?: string;
    };
    ctx.config.agent = {
      ...ctx.config.agent,
      provider: (provider as any) ?? "anthropic",
      model,
      providerApiKey,
    };
    return { ok: true, provider: ctx.config.agent.provider, model };
  });

  methods.set("config.getModels", async () => {
    return {
      current: {
        provider: ctx.config.agent?.provider ?? "anthropic",
        model: ctx.config.agent?.model ?? "sonnet",
      },
      available: [
        { provider: "anthropic", models: ["sonnet", "opus", "haiku"] },
        { provider: "together", models: [
          "meta-llama/Llama-3.3-70B-Instruct-Turbo",
          "mistralai/Mistral-7B-Instruct-v0.3",
          "deepseek-ai/DeepSeek-V3",
          "Qwen/Qwen2.5-72B-Instruct-Turbo",
        ]},
        { provider: "openai", models: ["gpt-4o", "gpt-4o-mini"] },
        { provider: "ollama", models: ["llama3.3"] },
      ],
    };
  });

  // ── Pairing ───────────────────────────────────────────────────────

  methods.set("pairing.list", async (_client, params) => {
    const { channelId } = params as { channelId: string };
    return { requests: loadPending(channelId) };
  });

  methods.set("pairing.approve", async (_client, params) => {
    const { channelId, code } = params as {
      channelId: string;
      code: string;
    };
    return approvePairingCode(channelId, code);
  });

  // ── Devices ──────────────────────────────────────────────────────

  methods.set("device.list", async () => {
    return { devices: loadPendingDevices() };
  });

  methods.set("device.approve", async (_client, params) => {
    const { deviceName } = params as { deviceName: string };
    return approveDevice(deviceName);
  });

  methods.set("device.status", async (client) => {
    // Re-check pairing status for this client
    if (!client.paired && client.deviceName) {
      client.paired = isDevicePaired(client.deviceName);
    }
    return { paired: client.paired, deviceName: client.deviceName };
  });

  // ── Workspace ─────────────────────────────────────────────────────

  methods.set("workspace.list", async () => {
    if (!ctx.workspaceDir) return { files: [], dir: null };

    const files: { name: string; exists: boolean; size: number }[] = [];
    for (const name of WORKSPACE_FILES) {
      const filePath = path.join(ctx.workspaceDir, name);
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        files.push({ name, exists: true, size: stat.size });
      } else {
        files.push({ name, exists: false, size: 0 });
      }
    }

    // Also list skills
    const skillsDir = path.join(ctx.workspaceDir, "skills");
    const skills: string[] = [];
    if (fs.existsSync(skillsDir)) {
      for (const entry of fs.readdirSync(skillsDir)) {
        const skillFile = path.join(skillsDir, entry, "SKILL.md");
        if (fs.existsSync(skillFile)) {
          skills.push(entry);
        }
      }
    }

    return { files, skills, dir: ctx.workspaceDir };
  });

  methods.set("workspace.read", async (_client, params) => {
    const { name } = params as { name: string };
    if (!ctx.workspaceDir) return { ok: false, error: "No workspace configured" };

    // Validate filename
    if (!WORKSPACE_FILES.includes(name) && !name.startsWith("skills/")) {
      return { ok: false, error: "Invalid workspace file" };
    }

    const filePath = path.join(ctx.workspaceDir, name);
    // Prevent path traversal
    if (!filePath.startsWith(ctx.workspaceDir)) {
      return { ok: false, error: "Invalid path" };
    }

    if (!fs.existsSync(filePath)) {
      return { ok: true, content: "", exists: false };
    }

    const content = fs.readFileSync(filePath, "utf-8");
    return { ok: true, content, exists: true };
  });

  methods.set("workspace.write", async (_client, params) => {
    const { name, content } = params as { name: string; content: string };
    if (!ctx.workspaceDir) return { ok: false, error: "No workspace configured" };

    if (!WORKSPACE_FILES.includes(name)) {
      return { ok: false, error: "Invalid workspace file" };
    }

    const filePath = path.join(ctx.workspaceDir, name);
    if (!filePath.startsWith(ctx.workspaceDir)) {
      return { ok: false, error: "Invalid path" };
    }

    // Atomic write
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, filePath);

    return { ok: true, note: "Changes take effect on next agent run" };
  });

  return methods;
}
