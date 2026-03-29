/**
 * Config loader — reads and validates Sapient config.
 *
 * Config file: ~/.sapient/config.json5
 * Supports JSON5 format (comments, trailing commas).
 * Supports env var substitution: "${VAR_NAME}".
 * Supports secrets: "$secret:name" reads from ~/.sapient/secrets/<name>.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import JSON5 from "json5";
import { DEFAULT_MODEL, type SapientConfig } from "@sapient/shared";

const STATE_DIR =
  process.env.SAPIENT_STATE_DIR ??
  path.join(os.homedir(), ".sapient");

const CONFIG_FILENAME = "config.json5";

/** Get the state directory path. */
export function getStateDir(): string {
  return STATE_DIR;
}

/** Get the default workspace directory path. */
export function getDefaultWorkspaceDir(): string {
  return process.env.SAPIENT_WORKSPACE_DIR ?? path.join(STATE_DIR, "workspace");
}

/** Get the config file path. */
export function getConfigPath(): string {
  return process.env.SAPIENT_CONFIG_PATH ?? path.join(STATE_DIR, CONFIG_FILENAME);
}

/**
 * Resolve variable references in a string value.
 * Supports:
 *   ${ENV_VAR}      — environment variable
 *   $secret:name    — reads from ~/.sapient/secrets/<name>
 */
function resolveEnvVars(value: string): string {
  // Resolve $secret:name references
  let resolved = value.replace(/\$secret:([a-zA-Z0-9_-]+)/g, (_, name) => {
    const secretPath = path.join(STATE_DIR, "secrets", name);
    try {
      return fs.readFileSync(secretPath, "utf-8").trim();
    } catch {
      console.warn(`[Config] Secret not found: ${secretPath}`);
      return "";
    }
  });
  // Resolve ${ENV_VAR} references
  resolved = resolved.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] ?? "";
  });
  return resolved;
}

/** Recursively resolve env vars in config values. */
function resolveEnvVarsDeep(obj: unknown): unknown {
  if (typeof obj === "string") {
    return resolveEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVarsDeep);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = resolveEnvVarsDeep(val);
    }
    return result;
  }
  return obj;
}

/** Load config from disk. Creates default config if none exists. */
export function loadConfig(): SapientConfig {
  const configPath = getConfigPath();

  // Ensure state dir exists
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }

  // If no config file, return defaults
  if (!fs.existsSync(configPath)) {
    return getDefaultConfig();
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON5.parse(raw) as SapientConfig;
    return resolveEnvVarsDeep(parsed) as SapientConfig;
  } catch (err) {
    console.error(
      `[Config] Failed to load ${configPath}: ${err instanceof Error ? err.message : err}`,
    );
    return getDefaultConfig();
  }
}

/** Write config to disk (atomic via temp file + rename). */
export function writeConfig(config: SapientConfig): void {
  const configPath = getConfigPath();

  // Ensure state dir exists
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }

  const content = JSON.stringify(config, null, 2);
  const tmpPath = configPath + ".tmp";
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, configPath);
}

/** Merge a partial config patch into the current config. */
export function patchConfig(
  patch: Partial<SapientConfig>,
): SapientConfig {
  const current = loadConfig();
  const merged = deepMerge(current, patch) as SapientConfig;
  writeConfig(merged);
  return merged;
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (
    source === null ||
    source === undefined ||
    typeof source !== "object" ||
    Array.isArray(source)
  ) {
    return source;
  }
  if (typeof target !== "object" || target === null || Array.isArray(target)) {
    return source;
  }
  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, val] of Object.entries(source as Record<string, unknown>)) {
    result[key] = deepMerge(result[key], val);
  }
  return result;
}

function getDefaultConfig(): SapientConfig {
  return {
    gateway: {
      port: 18789,
      bind: "loopback",
      authMode: "token",
    },
    agent: {
      model: DEFAULT_MODEL,
      permissionMode: "acceptEdits",
    },
    channels: {
      defaults: {
        dmPolicy: "pairing",
      },
    },
  };
}
