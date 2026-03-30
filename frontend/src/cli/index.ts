#!/usr/bin/env node

/**
 * Sapient CLI — entry point.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { createGateway } from "../gateway/server.js";
import { createMethods } from "../gateway/methods.js";
import type { GatewayContext } from "../gateway/methods.js";
import { ChannelRegistry } from "../channels/registry.js";
import { loadChannels, startChannels } from "../channels/loader.js";
import { loadConfig, getDefaultWorkspaceDir } from "../config/loader.js";
import { ensureAuth } from "../auth/auth.js";
import {
  loadPending,
  approvePairingCode,
  loadPendingDevices,
  approveDevice,
} from "../auth/pairing.js";
import { DEFAULT_MODEL, type Session, type SapientConfig } from "@sapient/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Seed the workspace directory with default files on first run.
 * Copies from the bundled workspace/ in the project root.
 * Only creates files that don't already exist — never overwrites.
 */
async function seedWorkspaceIfNeeded(workspaceDir: string): Promise<void> {
  // If the workspace dir already has a SOUL.md, it's been seeded
  if (fs.existsSync(path.join(workspaceDir, "SOUL.md"))) return;

  // Find the bundled workspace: relative to dist/src/cli/index.js → ../../workspace
  // In Docker the workspace is at /app/workspace (bundled in the image)
  const candidates = [
    path.resolve(__dirname, "../../../workspace-defaults"),      // local dev: dist/src/cli -> workspace-defaults/
    path.resolve(__dirname, "../../../../workspace-defaults"),    // alternate layout
    "/app/workspace-defaults",                                   // Docker
  ];

  let bundledDir: string | undefined;
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "SOUL.md"))) {
      bundledDir = c;
      break;
    }
  }

  if (!bundledDir) {
    console.log(`[Workspace] No bundled workspace found to seed; using ${workspaceDir}`);
    fs.mkdirSync(workspaceDir, { recursive: true });
    return;
  }

  console.log(`[Workspace] Seeding ${workspaceDir} from ${bundledDir}`);
  copyDirRecursive(bundledDir, workspaceDir);
}

/** Recursively copy a directory, skipping files that already exist at the destination. */
function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const program = new Command();

program
  .name("sapient")
  .description("Multi-channel AI agent platform")
  .version("0.1.0");

program
  .command("start")
  .description("Start the Sapient gateway and channels")
  .option("-p, --port <port>", "Gateway port")
  .option("--bind <mode>", "Bind mode: loopback, lan, custom")
  .option("-w, --workspace <dir>", "Workspace directory for SOUL.md, TOOLS.md, AGENTS.md")
  .action(async (opts) => {
    // Load config
    const config: SapientConfig = loadConfig();

    // Apply CLI overrides
    if (opts.port) {
      config.gateway = { ...config.gateway, port: parseInt(opts.port, 10) };
    }
    if (opts.bind) {
      config.gateway = { ...config.gateway, bind: opts.bind };
    }

    // Resolve workspace directory: CLI flag > config > default (~/.sapient/workspace/)
    const workspaceDir =
      opts.workspace ?? config.agent?.workspaceDir ?? getDefaultWorkspaceDir();

    // Seed default workspace on first run if it doesn't exist
    await seedWorkspaceIfNeeded(workspaceDir);

    let agentConfig = config.agent ?? { model: DEFAULT_MODEL };
    const { applyWorkspace } = await import("@sapient/backend");
    agentConfig = applyWorkspace(agentConfig, workspaceDir);
    console.log(`[Workspace] Loaded coaching from ${workspaceDir}`);
    if (agentConfig.subagents?.length) {
      console.log(
        `[Workspace] Subagents: ${agentConfig.subagents.map((s) => s.name).join(", ")}`,
      );
    }

    // Ensure auth is set up
    const authConfig = ensureAuth({
      mode: config.gateway?.authMode ?? "token",
      token: config.auth?.token ?? config.gateway?.token,
      password: config.auth?.password,
    });

    // Create gateway with auth config
    const gateway = createGateway({
      ...config.gateway,
      auth: authConfig,
    });

    // Create channel registry
    const channels = new ChannelRegistry();

    // Shared state
    const sessions = new Map<string, Session>();
    const abortControllers = new Map<string, AbortController>();
    const runSessions = new Map<string, string>();

    // Create gateway context
    const ctx: GatewayContext = {
      config: { ...config, agent: agentConfig },
      channels,
      sessions,
      abortControllers,
      runSessions,
      broadcastToSession: gateway.broadcastToSession,
      workspaceDir,
    };

    // Register RPC methods
    const methods = createMethods(ctx);
    gateway.registerMethods(methods);

    // Route inbound channel messages to the agent
    channels.onMessage(async (msg) => {
      const sessionKey = `@${msg.channelId}:${msg.from}`;
      console.log(`[Router] ${sessionKey}: "${msg.text}"`);

      const { runAgent } = await import("@sapient/backend");

      const ac = new AbortController();
      abortControllers.set(msg.id, ac);

      const result = await runAgent(msg, sessionKey, {
        runId: msg.id,
        config: agentConfig,
        abortController: ac,
        onStreamEvent(event) {
          gateway.broadcastToSession(sessionKey, event);

          // Send reply back through the channel
          // For Twitter, reply to the tweet ID; for others, reply to the sender
          if (event.type === "text.done" && event.data.type === "text.done") {
            const replyTo = msg.channelId === "twitter" ? msg.id : msg.from;
            channels
              .sendReply(msg.channelId, msg.accountId ?? "default", replyTo, {
                text: event.data.text,
              })
              .catch((err) =>
                console.error(`[Router] Reply failed: ${err}`),
              );
          }
        },
      });

      abortControllers.delete(msg.id);

      if (result.error) {
        console.error(`[Router] Agent error: ${result.error}`);
      }
    });

    // Load and start configured channels
    if (config.channels) {
      await loadChannels(channels, config.channels);
      await startChannels(channels, config.channels);
    }

    // Start gateway
    await gateway.start();

    const runningChannels = channels.list().filter((c) => c.status === "running");
    console.log("[Sapient] Started.");
    if (authConfig.token) {
      console.log(`[Sapient] Gateway token: ${authConfig.token}`);
    }
    if (runningChannels.length > 0) {
      console.log(
        `[Sapient] Channels: ${runningChannels.map((c) => c.plugin.meta.label).join(", ")}`,
      );
    }
    console.log("[Sapient] Press Ctrl+C to stop.");

    // Graceful shutdown
    const shutdown = async () => {
      console.log("\n[Sapient] Shutting down...");
      await channels.stopAll();
      await gateway.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program
  .command("status")
  .description("Show gateway and channel status")
  .action(() => {
    console.log("TODO: Connect to running gateway and show status");
  });

program
  .command("pairing")
  .description("Manage DM pairing")
  .addCommand(
    new Command("list")
      .argument("<channelId>", "Channel ID")
      .action((channelId: string) => {
        const pending = loadPending(channelId);
        if (pending.length === 0) {
          console.log("No pending pairing requests.");
        } else {
          for (const req of pending) {
            console.log(`  ${req.from} — code: ${req.code}`);
          }
        }
      }),
  )
  .addCommand(
    new Command("approve")
      .argument("<channelId>", "Channel ID")
      .argument("<code>", "Pairing code")
      .action((channelId: string, code: string) => {
        const result = approvePairingCode(channelId, code);
        if (result.ok) {
          console.log(`Approved: ${result.from}`);
        } else {
          console.error(`Failed: ${result.error}`);
        }
      }),
  );

program
  .command("device")
  .description("Manage device pairing")
  .addCommand(
    new Command("list")
      .description("List pending device pairing requests")
      .action(() => {
        const pending = loadPendingDevices();
        if (pending.length === 0) {
          console.log("No pending device pairing requests.");
        } else {
          console.log("Pending devices:");
          for (const req of pending) {
            const age = Math.round((Date.now() - req.createdAt) / 1000);
            console.log(`  ${req.deviceName}  (${age}s ago)`);
          }
        }
      }),
  )
  .addCommand(
    new Command("approve")
      .argument("<deviceName>", "Device name to approve")
      .description("Approve a device for chat access")
      .action((deviceName: string) => {
        const result = approveDevice(deviceName);
        if (result.ok) {
          console.log(`Approved device: ${deviceName}`);
        } else {
          console.error(`Failed: ${result.error}`);
        }
      }),
  );

program.parse();
