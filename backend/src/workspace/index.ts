/**
 * Workspace coaching — reads SOUL.md, TOOLS.md, AGENTS.md from a workspace
 * directory and wires them into Claude Agent SDK options.
 *
 * File conventions:
 *   SOUL.md     — System prompt / personality / instructions
 *   TOOLS.md    — Tool usage guidance injected into system prompt
 *   AGENTS.md   — Subagent definitions (YAML front matter per agent)
 *   IDENTITY.md — Agent name/avatar
 *   USER.md     — User context (who the user is, preferences)
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, SubagentConfig } from "@sapient/shared";
import { loadAllSkills, buildSkillsPrompt } from "./skills.js";
import type { Skill } from "./skills.js";

export interface WorkspaceFiles {
  soul?: string;
  tools?: string;
  agents?: string;
  identity?: string;
  user?: string;
  knowledge?: string;
}

const WORKSPACE_FILES: Record<keyof WorkspaceFiles, string> = {
  soul: "SOUL.md",
  tools: "TOOLS.md",
  agents: "AGENTS.md",
  identity: "IDENTITY.md",
  user: "USER.md",
  knowledge: "KNOWLEDGE.md",
};

/** Read all workspace coaching files from a directory. */
export function readWorkspace(workspaceDir: string): WorkspaceFiles {
  const files: WorkspaceFiles = {};
  for (const [key, filename] of Object.entries(WORKSPACE_FILES)) {
    const filePath = path.join(workspaceDir, filename);
    if (fs.existsSync(filePath)) {
      files[key as keyof WorkspaceFiles] = fs.readFileSync(filePath, "utf-8").trim();
    }
  }
  return files;
}

/** Build a system prompt from workspace files and skills. */
export function buildSystemPrompt(
  workspace: WorkspaceFiles,
  skills?: Skill[],
): string {
  const parts: string[] = [];

  if (workspace.soul) {
    parts.push(workspace.soul);
  }

  if (workspace.identity) {
    parts.push(`\n## Identity\n${workspace.identity}`);
  }

  if (workspace.user) {
    parts.push(`\n## About the User\n${workspace.user}`);
  }

  if (workspace.tools) {
    parts.push(`\n## Tool Usage Guidelines\n${workspace.tools}`);
  }

  if (workspace.knowledge) {
    parts.push(`\n## Knowledge Base\n${workspace.knowledge}`);
  }

  // Append skills inventory
  if (skills && skills.length > 0) {
    parts.push(`\n${buildSkillsPrompt(skills)}`);
  }

  return parts.join("\n\n");
}

/**
 * Parse AGENTS.md into subagent definitions.
 *
 * Expected format — each agent separated by `---`:
 * ```
 * ---
 * name: researcher
 * description: Research agent for web searches
 * allowedTools: ["WebSearch", "Read"]
 * ---
 * You are a research specialist. Search the web and summarize findings.
 *
 * ---
 * name: coder
 * description: Coding agent for writing and editing files
 * allowedTools: ["Read", "Write", "Edit", "Bash"]
 * ---
 * You are a coding specialist. Write clean, tested code.
 * ```
 */
export function parseAgentDefinitions(agentsContent: string): SubagentConfig[] {
  const agents: SubagentConfig[] = [];
  const sections = agentsContent.split(/^---\s*$/m).filter((s) => s.trim());

  let i = 0;
  while (i < sections.length) {
    const headerSection = sections[i].trim();
    const bodySection = i + 1 < sections.length ? sections[i + 1].trim() : "";

    // Parse YAML-like front matter
    const nameMatch = headerSection.match(/^name:\s*(.+)$/m);
    const descMatch = headerSection.match(/^description:\s*(.+)$/m);
    const toolsMatch = headerSection.match(/^allowedTools:\s*\[([^\]]*)\]/m);

    if (nameMatch && descMatch) {
      const allowedTools = toolsMatch
        ? toolsMatch[1]
            .split(",")
            .map((t) => t.trim().replace(/"/g, "").replace(/'/g, ""))
            .filter(Boolean)
        : undefined;

      agents.push({
        name: nameMatch[1].trim(),
        description: descMatch[1].trim(),
        systemPrompt: bodySection || undefined,
        allowedTools,
      });
      i += 2;
    } else {
      i += 1;
    }
  }

  return agents;
}

/**
 * Apply workspace coaching to an agent config.
 * Reads workspace files and merges system prompt + subagent definitions.
 */
export function applyWorkspace(
  config: AgentConfig,
  workspaceDir?: string,
): AgentConfig {
  const dir = workspaceDir ?? config.workspaceDir;
  if (!dir || !fs.existsSync(dir)) return config;

  const workspace = readWorkspace(dir);
  const skills = loadAllSkills(dir);
  const result = { ...config };

  if (skills.length > 0) {
    console.log(
      `[Workspace] Loaded ${skills.length} skills: ${skills.map((s) => s.meta.name).join(", ")}`,
    );
  }

  // Build system prompt from workspace files + skills
  const workspacePrompt = buildSystemPrompt(workspace, skills);
  if (workspacePrompt) {
    result.systemPrompt = config.systemPrompt
      ? `${workspacePrompt}\n\n${config.systemPrompt}`
      : workspacePrompt;
  }

  // Parse subagent definitions from AGENTS.md
  if (workspace.agents) {
    const parsed = parseAgentDefinitions(workspace.agents);
    if (parsed.length > 0) {
      result.subagents = [...(config.subagents ?? []), ...parsed];
    }
  }

  return result;
}
