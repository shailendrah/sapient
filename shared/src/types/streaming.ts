/**
 * Streaming event types — events emitted during agent execution.
 * These flow from the backend (Claude Agent SDK) through the gateway to clients.
 */

/** All possible stream event types. */
export type StreamEventType =
  | "agent.start"
  | "agent.complete"
  | "agent.error"
  | "text.delta"
  | "text.done"
  | "tool.use"
  | "tool.result"
  | "subagent.start"
  | "subagent.complete"
  | "approval.request"
  | "approval.response";

/** A single streaming event. */
export interface StreamEvent {
  /** Event type. */
  type: StreamEventType;
  /** Run ID for this agent execution. */
  runId: string;
  /** Session key linking this to a conversation. */
  sessionKey: string;
  /** Sequence number for ordering. */
  seq: number;
  /** Timestamp (ms since epoch). */
  timestamp: number;
  /** Event-specific payload. */
  data: StreamEventData;
}

/** Event-specific data payloads. */
export type StreamEventData =
  | TextDeltaData
  | TextDoneData
  | ToolUseData
  | ToolResultData
  | SubagentStartData
  | SubagentCompleteData
  | ApprovalRequestData
  | ApprovalResponseData
  | AgentStartData
  | AgentCompleteData
  | AgentErrorData;

export interface TextDeltaData {
  type: "text.delta";
  text: string;
}

export interface TextDoneData {
  type: "text.done";
  text: string;
}

export interface ToolUseData {
  type: "tool.use";
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
}

export interface ToolResultData {
  type: "tool.result";
  toolId: string;
  output: unknown;
  isError?: boolean;
}

export interface SubagentStartData {
  type: "subagent.start";
  subagentId: string;
  name: string;
  description?: string;
}

export interface SubagentCompleteData {
  type: "subagent.complete";
  subagentId: string;
  result: unknown;
}

export interface ApprovalRequestData {
  type: "approval.request";
  approvalId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  prompt: string;
}

export interface ApprovalResponseData {
  type: "approval.response";
  approvalId: string;
  approved: boolean;
  message?: string;
}

export interface AgentStartData {
  type: "agent.start";
}

export interface AgentCompleteData {
  type: "agent.complete";
  finalText?: string;
}

export interface AgentErrorData {
  type: "agent.error";
  error: string;
}
