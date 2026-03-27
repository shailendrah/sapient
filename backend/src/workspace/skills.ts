/**
 * Skills system — discovers and loads custom skills from workspace directories.
 * Skills are directories containing a SKILL.md file with YAML frontmatter.
 *
 * Loading precedence (highest to lowest):
 *   1. workspace/skills/      (project-level)
 *   2. ~/.sapient/skills/  (user-level)
 *   3. bundled skills (future)
 *
 * SKILL.md format:
 * ```
 * ---
 * name: my-skill
 * description: Does something useful
 * emoji: "🔧"
 * requires:
 *   bins: ["curl"]
 * ---
 * # My Skill
 * Instructions for using this skill...
 * ```
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface SkillMeta {
  name: string;
  description: string;
  emoji?: string;
  requires?: {
    bins?: string[];
  };
}

export interface Skill {
  meta: SkillMeta;
  content: string;
  source: string;
  dir: string;
}

const MAX_SKILL_SIZE = 256 * 1024; // 256KB
const MAX_SKILLS_PER_DIR = 100;

/** Parse YAML-like frontmatter from a SKILL.md file. */
function parseFrontmatter(raw: string): { meta: Partial<SkillMeta>; content: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, content: raw.trim() };
  }

  const yamlBlock = match[1];
  const content = match[2].trim();
  const meta: Partial<SkillMeta> = {};

  // Simple YAML-like parsing (no full YAML parser needed)
  for (const line of yamlBlock.split("\n")) {
    const kv = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/);
    if (kv) {
      const [, key, value] = kv;
      if (key === "name") meta.name = value;
      else if (key === "description") meta.description = value;
      else if (key === "emoji") meta.emoji = value;
    }
    // Parse requires.bins
    const binsMatch = line.match(/^\s+bins:\s*\[([^\]]*)\]/);
    if (binsMatch) {
      meta.requires = {
        bins: binsMatch[1]
          .split(",")
          .map((b) => b.trim().replace(/"/g, "").replace(/'/g, ""))
          .filter(Boolean),
      };
    }
  }

  return { meta, content };
}

/** Load skills from a single directory. */
export function loadSkillsFromDir(
  dir: string,
  source: string,
): Skill[] {
  if (!fs.existsSync(dir)) return [];

  const skills: Skill[] = [];
  let entries: string[];

  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  let count = 0;
  for (const entry of entries) {
    if (count >= MAX_SKILLS_PER_DIR) break;

    const skillDir = path.join(dir, entry);
    const skillFile = path.join(skillDir, "SKILL.md");

    if (!fs.existsSync(skillFile)) continue;

    try {
      const stat = fs.statSync(skillFile);
      if (stat.size > MAX_SKILL_SIZE) {
        console.warn(`[Skills] Skipping ${entry}: exceeds ${MAX_SKILL_SIZE / 1024}KB limit`);
        continue;
      }

      const raw = fs.readFileSync(skillFile, "utf-8");
      const { meta, content } = parseFrontmatter(raw);

      skills.push({
        meta: {
          name: meta.name ?? entry,
          description: meta.description ?? "",
          emoji: meta.emoji,
          requires: meta.requires,
        },
        content,
        source,
        dir: skillDir,
      });
      count++;
    } catch (err) {
      console.warn(
        `[Skills] Failed to load ${entry}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return skills;
}

/** Load skills from all sources with precedence. */
export function loadAllSkills(workspaceDir?: string): Skill[] {
  const skillMap = new Map<string, Skill>();

  // 1. User-level skills (lowest precedence)
  const userDir = path.join(
    process.env.SAPIENT_STATE_DIR ?? path.join(os.homedir(), ".sapient"),
    "skills",
  );
  for (const skill of loadSkillsFromDir(userDir, "user")) {
    skillMap.set(skill.meta.name, skill);
  }

  // 2. Workspace skills (highest precedence — overrides user)
  if (workspaceDir) {
    const wsSkillsDir = path.join(workspaceDir, "skills");
    for (const skill of loadSkillsFromDir(wsSkillsDir, "workspace")) {
      skillMap.set(skill.meta.name, skill);
    }
  }

  return Array.from(skillMap.values());
}

/** Build a prompt section describing available skills. */
export function buildSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const lines = ["## Available Skills\n"];
  for (const skill of skills) {
    const emoji = skill.meta.emoji ? `${skill.meta.emoji} ` : "";
    lines.push(`### ${emoji}${skill.meta.name}`);
    if (skill.meta.description) {
      lines.push(skill.meta.description);
    }
    if (skill.content) {
      lines.push("");
      lines.push(skill.content);
    }
    lines.push("");
  }

  return lines.join("\n");
}
