/**
 * Sapient Agent — wraps the Claude Agent SDK.
 * This is the core backend.
 */

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import {
  DEFAULT_MODEL,
  type StreamEvent,
  type StreamEventType,
  type InboundMessage,
  type AgentConfig,
  type SubagentConfig,
} from "@sapient/shared";

/** Callback for streaming events during agent execution. */
export type OnStreamEvent = (event: StreamEvent) => void;

/** Callback for human-in-the-loop approval requests. */
export type OnApprovalRequest = (
  toolName: string,
  toolInput: Record<string, unknown>,
) => Promise<{ approved: boolean; message?: string }>;

/** Options for creating a Sapient agent. */
export interface AgentOptions {
  config: AgentConfig;
  onStreamEvent: OnStreamEvent;
  onApprovalRequest?: OnApprovalRequest;
  /** Abort controller to cancel the agent run. */
  abortController?: AbortController;
}

/** Result of an agent run. */
export interface AgentRunResult {
  runId: string;
  finalText?: string;
  error?: string;
}

let seqCounter = 0;

function makeEvent(
  type: StreamEventType,
  runId: string,
  sessionKey: string,
  data: StreamEvent["data"],
): StreamEvent {
  return {
    type,
    runId,
    sessionKey,
    seq: ++seqCounter,
    timestamp: Date.now(),
    data,
  };
}

/**
 * Run the Claude Agent SDK on an inbound message.
 * Streams events back via onStreamEvent callback.
 */
export async function runAgent(
  message: InboundMessage,
  sessionKey: string,
  options: AgentOptions,
): Promise<AgentRunResult> {
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { config, onStreamEvent, onApprovalRequest, abortController } = options;

  onStreamEvent(
    makeEvent("agent.start", runId, sessionKey, { type: "agent.start" }),
  );

  let finalText = "";

  try {
    // Build subagent definitions
    const agents: Record<string, { description: string; prompt: string; tools?: string[]; model?: string }> = {};
    if (config.subagents) {
      for (const sub of config.subagents) {
        agents[sub.name] = {
          description: sub.description,
          prompt: sub.systemPrompt ?? "",
          tools: sub.allowedTools,
        };
      }
    }

    // Create the query
    const agentQuery = sdkQuery({
      prompt: message.text,
      options: {
        model: config.model ?? DEFAULT_MODEL,
        systemPrompt: config.systemPrompt,
        maxTurns: 50,
        permissionMode: config.permissionMode ?? "acceptEdits",
        allowDangerouslySkipPermissions:
          config.permissionMode === "bypassPermissions" ? true : undefined,
        agents: Object.keys(agents).length > 0 ? agents : undefined,
        abortController,

        // Human-in-the-loop: intercept tool approvals
        canUseTool: onApprovalRequest
          ? async (toolName: string, toolInput: Record<string, unknown>) => {
              const result = await onApprovalRequest(toolName, toolInput);
              if (result.approved) {
                return { behavior: "allow" as const };
              }
              return {
                behavior: "deny" as const,
                message: result.message ?? "Denied by user",
              };
            }
          : undefined,
      },
    });

    // Stream messages from the agent
    for await (const msg of agentQuery) {
      switch (msg.type) {
        case "assistant": {
          // Extract text from the assistant message content blocks
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") {
                finalText += block.text;
                onStreamEvent(
                  makeEvent("text.delta", runId, sessionKey, {
                    type: "text.delta",
                    text: block.text,
                  }),
                );
              } else if (block.type === "tool_use") {
                onStreamEvent(
                  makeEvent("tool.use", runId, sessionKey, {
                    type: "tool.use",
                    toolName: block.name,
                    toolId: block.id,
                    input: block.input as Record<string, unknown>,
                  }),
                );
              }
            }
          }
          break;
        }

        case "result": {
          // Final result
          if ("text" in msg && typeof msg.text === "string") {
            finalText = msg.text;
          }
          break;
        }

        case "system": {
          // Subagent lifecycle events
          const sysMsg = msg as any;
          if (sysMsg.subtype === "task_started") {
            onStreamEvent(
              makeEvent("subagent.start", runId, sessionKey, {
                type: "subagent.start",
                subagentId: sysMsg.task_id,
                name: sysMsg.description ?? sysMsg.task_type ?? "subagent",
                description: sysMsg.prompt,
              }),
            );
          } else if (sysMsg.subtype === "task_progress") {
            // Emit as a tool event so UI shows progress
            onStreamEvent(
              makeEvent("tool.result", runId, sessionKey, {
                type: "tool.result",
                toolId: sysMsg.task_id,
                output: {
                  description: sysMsg.description,
                  summary: sysMsg.summary,
                  lastTool: sysMsg.last_tool_name,
                  tokens: sysMsg.usage?.total_tokens,
                  toolUses: sysMsg.usage?.tool_uses,
                  durationMs: sysMsg.usage?.duration_ms,
                },
              }),
            );
          } else if (sysMsg.subtype === "task_notification") {
            onStreamEvent(
              makeEvent("subagent.complete", runId, sessionKey, {
                type: "subagent.complete",
                subagentId: sysMsg.task_id,
                result: {
                  status: sysMsg.status,
                  summary: sysMsg.summary,
                  tokens: sysMsg.usage?.total_tokens,
                  toolUses: sysMsg.usage?.tool_uses,
                  durationMs: sysMsg.usage?.duration_ms,
                },
              }),
            );
          }
          break;
        }

        case "tool_progress": {
          // Tool execution progress
          const toolMsg = msg as any;
          onStreamEvent(
            makeEvent("tool.result", runId, sessionKey, {
              type: "tool.result",
              toolId: toolMsg.tool_use_id,
              output: toolMsg.content ?? toolMsg.data,
            }),
          );
          break;
        }

        default:
          // Other message types — log for debugging
          break;
      }
    }

    // Done
    onStreamEvent(
      makeEvent("text.done", runId, sessionKey, {
        type: "text.done",
        text: finalText,
      }),
    );

    onStreamEvent(
      makeEvent("agent.complete", runId, sessionKey, {
        type: "agent.complete",
        finalText,
      }),
    );

    return { runId, finalText };
  } catch (err) {
    const errorMsg = err instanceof Error
      ? `${err.message}${err.stack ? `\n${err.stack}` : ""}`
      : String(err);
    console.error(`[Agent] Error in run ${runId}: ${errorMsg}`);
    onStreamEvent(
      makeEvent("agent.error", runId, sessionKey, {
        type: "agent.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { runId, error: err instanceof Error ? err.message : String(err) };
  }
}
