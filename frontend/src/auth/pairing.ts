/**
 * DM Pairing — challenge/approval flow for unknown senders.
 * Simplified from OpenClaw's 852-line pairing-store.ts.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getStateDir } from "../config/loader.js";

const PAIRING_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_PENDING = 3;
const MAX_PENDING_DEVICES = 20;

export interface PairingRequest {
  from: string;
  channelId: string;
  code: string;
  createdAt: number;
}

export interface AllowStore {
  version: number;
  allowFrom: string[];
}

function getPairingDir(): string {
  return path.join(getStateDir(), "pairing");
}

function getPairingFile(channelId: string): string {
  return path.join(getPairingDir(), `${channelId}-pending.json`);
}

function getAllowFile(channelId: string): string {
  return path.join(getPairingDir(), `${channelId}-allow.json`);
}

function ensureDir(): void {
  const dir = getPairingDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function generateCode(): string {
  // 8-char uppercase alphanumeric code
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

/** Load pending pairing requests for a channel. */
export function loadPending(channelId: string): PairingRequest[] {
  const filePath = getPairingFile(channelId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PairingRequest[];
    // Filter expired
    const now = Date.now();
    return data.filter((r) => now - r.createdAt < PAIRING_TTL_MS);
  } catch {
    return [];
  }
}

function savePending(channelId: string, requests: PairingRequest[]): void {
  ensureDir();
  fs.writeFileSync(getPairingFile(channelId), JSON.stringify(requests, null, 2));
}

/** Create a pairing request. Returns the code to present to the user. */
export function createPairingRequest(
  channelId: string,
  from: string,
): string {
  const pending = loadPending(channelId);

  // Check if already pending
  const existing = pending.find((r) => r.from === from);
  if (existing) return existing.code;

  // Enforce max pending
  if (pending.length >= MAX_PENDING) {
    // Remove oldest
    pending.shift();
  }

  const code = generateCode();
  pending.push({ from, channelId, code, createdAt: Date.now() });
  savePending(channelId, pending);
  return code;
}

/** Approve a pairing code, adding the sender to the allow list. */
export function approvePairingCode(
  channelId: string,
  code: string,
): { ok: boolean; from?: string; error?: string } {
  const pending = loadPending(channelId);
  const idx = pending.findIndex((r) => r.code === code);
  if (idx === -1) {
    return { ok: false, error: "Invalid or expired pairing code" };
  }

  const request = pending[idx];
  pending.splice(idx, 1);
  savePending(channelId, pending);

  // Add to allow list
  addToAllowList(channelId, request.from);
  return { ok: true, from: request.from };
}

/** Load the allow list for a channel. */
export function loadAllowList(channelId: string): string[] {
  const filePath = getAllowFile(channelId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as AllowStore;
    return data.allowFrom ?? [];
  } catch {
    return [];
  }
}

/** Add a sender to the allow list. */
export function addToAllowList(channelId: string, from: string): void {
  ensureDir();
  const list = loadAllowList(channelId);
  if (!list.includes(from)) {
    list.push(from);
    const store: AllowStore = { version: 1, allowFrom: list };
    fs.writeFileSync(getAllowFile(channelId), JSON.stringify(store, null, 2));
  }
}

/** Remove a sender from the allow list. */
export function removeFromAllowList(channelId: string, from: string): void {
  const list = loadAllowList(channelId);
  const filtered = list.filter((f) => f !== from);
  const store: AllowStore = { version: 1, allowFrom: filtered };
  ensureDir();
  fs.writeFileSync(getAllowFile(channelId), JSON.stringify(store, null, 2));
}

/** Check if a sender is allowed (on the allow list or allowFrom config includes them). */
export function isAllowed(
  channelId: string,
  from: string,
  configAllowFrom?: string[],
): boolean {
  // Check config allowFrom (e.g., ["*"] for open policy)
  if (configAllowFrom?.includes("*")) return true;
  if (configAllowFrom?.includes(from)) return true;

  // Check persisted allow list
  return loadAllowList(channelId).includes(from);
}

// ── Device Pairing (webchat / gateway connections) ────────────────────

export interface DevicePairingRequest {
  connId: string;
  deviceName: string;
  createdAt: number;
}

export interface DeviceAllowStore {
  version: number;
  devices: string[]; // approved device names
}

function getDevicePairingFile(): string {
  return path.join(getPairingDir(), "devices-pending.json");
}

function getDeviceAllowFile(): string {
  return path.join(getPairingDir(), "devices-allow.json");
}

/** Load pending device pairing requests. */
export function loadPendingDevices(): DevicePairingRequest[] {
  const filePath = getDevicePairingFile();
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as DevicePairingRequest[];
    const now = Date.now();
    return data.filter((r) => now - r.createdAt < PAIRING_TTL_MS);
  } catch {
    return [];
  }
}

function savePendingDevices(requests: DevicePairingRequest[]): void {
  ensureDir();
  fs.writeFileSync(getDevicePairingFile(), JSON.stringify(requests, null, 2));
}

/** Create a device pairing request. Returns the device name for display. */
export function createDevicePairingRequest(connId: string): string {
  const pending = loadPendingDevices();

  // Check if this connection already has a pending request
  const existing = pending.find((r) => r.connId === connId);
  if (existing) return existing.deviceName;

  // Generate a short human-readable device name
  const deviceName = `device-${crypto.randomBytes(3).toString("hex")}`;

  // Enforce max pending
  if (pending.length >= MAX_PENDING_DEVICES) {
    pending.shift();
  }

  pending.push({ connId, deviceName, createdAt: Date.now() });
  savePendingDevices(pending);
  return deviceName;
}

/** Approve a device by name, adding it to the allowed devices list. */
export function approveDevice(
  deviceName: string,
): { ok: boolean; connId?: string; error?: string } {
  const pending = loadPendingDevices();
  const idx = pending.findIndex((r) => r.deviceName === deviceName);
  if (idx === -1) {
    return { ok: false, error: `No pending device: ${deviceName}` };
  }

  const request = pending[idx];
  pending.splice(idx, 1);
  savePendingDevices(pending);

  addToDeviceAllowList(request.deviceName);
  return { ok: true, connId: request.connId };
}

/** Load allowed device names. */
export function loadDeviceAllowList(): string[] {
  const filePath = getDeviceAllowFile();
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as DeviceAllowStore;
    return data.devices ?? [];
  } catch {
    return [];
  }
}

function addToDeviceAllowList(deviceName: string): void {
  ensureDir();
  const list = loadDeviceAllowList();
  if (!list.includes(deviceName)) {
    list.push(deviceName);
    const store: DeviceAllowStore = { version: 1, devices: list };
    fs.writeFileSync(getDeviceAllowFile(), JSON.stringify(store, null, 2));
  }
}

/** Check if a device name is in the approved list. */
export function isDevicePaired(deviceName: string): boolean {
  return loadDeviceAllowList().includes(deviceName);
}

/** Find the device name for a connection (from pending or approved). */
export function getDeviceNameForConn(connId: string): string | undefined {
  const pending = loadPendingDevices();
  return pending.find((r) => r.connId === connId)?.deviceName;
}
