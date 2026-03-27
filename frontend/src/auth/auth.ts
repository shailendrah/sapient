/**
 * Gateway authentication — token/password auth with rate limiting.
 * Simplified from OpenClaw's 500-line auth.ts.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getStateDir } from "../config/loader.js";

export type AuthMode = "none" | "token" | "password";

export interface AuthConfig {
  mode: AuthMode;
  token?: string;
  password?: string;
}

export interface AuthResult {
  ok: boolean;
  reason?: string;
  rateLimited?: boolean;
}

/** Rate limiter: track failed auth attempts per IP. */
const failedAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.lastAttempt > WINDOW_MS) {
    failedAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string): void {
  const entry = failedAttempts.get(ip) ?? { count: 0, lastAttempt: 0 };
  entry.count++;
  entry.lastAttempt = Date.now();
  failedAttempts.set(ip, entry);
}

/** Constant-time string comparison for secrets. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Authorize a gateway connection. */
export function authorizeConnection(
  authConfig: AuthConfig,
  providedAuth: { token?: string; password?: string },
  clientIp: string,
): AuthResult {
  if (authConfig.mode === "none") {
    return { ok: true };
  }

  if (isRateLimited(clientIp)) {
    return { ok: false, reason: "Rate limited", rateLimited: true };
  }

  if (authConfig.mode === "token" && authConfig.token) {
    if (!providedAuth.token) {
      recordFailedAttempt(clientIp);
      return { ok: false, reason: "Token required" };
    }
    if (!safeEqual(authConfig.token, providedAuth.token)) {
      recordFailedAttempt(clientIp);
      return { ok: false, reason: "Invalid token" };
    }
    return { ok: true };
  }

  if (authConfig.mode === "password" && authConfig.password) {
    if (!providedAuth.password) {
      recordFailedAttempt(clientIp);
      return { ok: false, reason: "Password required" };
    }
    if (!safeEqual(authConfig.password, providedAuth.password)) {
      recordFailedAttempt(clientIp);
      return { ok: false, reason: "Invalid password" };
    }
    return { ok: true };
  }

  // Fallback: auth mode set but no credential configured
  return { ok: true };
}

/** Generate a random auth token. */
export function generateToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

/** Ensure auth is configured. Auto-generate token if needed. */
export function ensureAuth(config: AuthConfig): AuthConfig {
  if (config.mode === "token" && !config.token) {
    const token = generateToken();
    config.token = token;

    // Persist token to state dir
    const tokenPath = path.join(getStateDir(), "gateway-token");
    const stateDir = getStateDir();
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(tokenPath, token, { mode: 0o600 });
    console.log(`[Auth] Generated gateway token: ${token}`);
  }

  if (config.mode === "password" && !config.password) {
    console.warn(
      "[Auth] WARNING: password auth mode is set but no password is configured. " +
      "Set auth.password in config.json5 or SAPIENT_AUTH_PASSWORD env var.",
    );
  }

  if (config.mode === "none") {
    console.warn("[Auth] WARNING: auth is disabled. The gateway is open to anyone who can reach it.");
  }

  return config;
}
