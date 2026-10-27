"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ActivityType, Position, Presence, Priority, Source, TaskStatus } from "./constants";

export interface Member {
  _id: string;
  name: string;
  role: "admin" | "member";
  position: Position | null;
  telegramUsername: string | null;
  telegramId: string | null;
  presence: Presence;
  presenceNote: string | null;
  presenceSince: string;
  lastSeenAt: string | null;
  openTasks: number;
}

export interface TaskRow {
  _id: string;
  number: number | null;
  priority: Priority;
  team: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  progress: number;
  dueDate: string | null;
  completedAt: string | null;
  source: Source;
  createdAt: string;
  updatedAt: string;
  assignee: { _id: string; name: string } | null;
  collaborators: { _id: string; name: string }[];
  createdBy: { _id: string; name: string } | null;
}

export interface LogRow {
  _id: string;
  type: ActivityType;
  message: string;
  source: Source;
  rawText: string | null;
  aiConfidence: number | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
  user: { _id: string; name: string } | null;
  actor: { _id: string; name: string } | null;
  task: { _id: string; title: string } | null;
}

export interface TeamSummary {
  _id: string;
  name: string;
  color: string;
  telegramLinked: boolean;
  memberIds: string[];
  leadId: string | null;
  managerId: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
}

/** Remembered per browser; storage can be unavailable (private mode), so never throw. */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export interface TrackerData {
  me: { _id: string; role: "admin" | "member"; position: Position | null; teamIds: string[] };
  members: Member[];
  teams: TeamSummary[];
  tasks: TaskRow[];
  stats: {
    online: number;
    onBreak: number;
    offline: number;
    inProgress: number;
    blocked: number;
    doneToday: number;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

/** Event other components fire after changing data, so live views refetch immediately. */
export const REFRESH_EVENT = "tt:refresh";
export const emitRefresh = () => window.dispatchEvent(new Event(REFRESH_EVENT));

/** Fetches `url` now, every `intervalMs`, and whenever REFRESH_EVENT fires. Pauses in background tabs. */
export function usePolling<T>(url: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const load = useCallback(async () => {
    if (!urlRef.current) return;
    try {
      setData(await api<T>(urlRef.current));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const tick = () => document.visibilityState === "visible" && load();
    const id = setInterval(tick, intervalMs);
    window.addEventListener(REFRESH_EVENT, load);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener(REFRESH_EVENT, load);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [url, intervalMs, load]);

  return { data, error, reload: load };
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function duration(iso: string | null | undefined) {
  if (!iso) return "";
  const m = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${Math.floor(m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${Math.floor(m % 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Due dates are stored as UTC midnight of the chosen day. */
export function formatDue(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

export function isOverdue(task: Pick<TaskRow, "dueDate" | "status">) {
  if (!task.dueDate || task.status === "done") return false;
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return new Date(task.dueDate).getTime() < todayUtc;
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------- profile photos ----------
// One small map of who has a photo (id → version), shared by every <Avatar> on the page.

let avatarVersions: Record<string, number> = {};
let avatarsRequested = false;
const avatarListeners = new Set<() => void>();

export async function reloadAvatars() {
  avatarsRequested = true;
  try {
    const { versions } = await api<{ versions: Record<string, number> }>("/api/avatars");
    avatarVersions = versions;
    avatarListeners.forEach((l) => l());
  } catch {
    // keep showing initials
  }
}

function subscribeAvatars(listener: () => void) {
  avatarListeners.add(listener);
  if (!avatarsRequested) reloadAvatars();
  return () => avatarListeners.delete(listener);
}

/** The version of someone's photo, or undefined when they have none (or before the list has loaded). */
export function useAvatarVersion(userId: string | null | undefined) {
  return useSyncExternalStore(
    subscribeAvatars,
    () => (userId ? avatarVersions[userId] : undefined),
    () => undefined,
  );
}
