"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatDateTime, REFRESH_EVENT, timeAgo, type LogRow, type Member } from "@/lib/client";
import { ACTIVITY_LABEL, ACTIVITY_TYPES, type ActivityType } from "@/lib/constants";
import { EmptyState, SourceTag, Spinner } from "./ui";

interface Props {
  title?: string;
  /** Lock the log to one person (profile page). */
  userId?: string;
  /** Lock the log to one task (task modal). */
  taskId?: string;
  /** Show a person filter (tracker page). */
  members?: Member[];
  /** No card chrome or filters — for embedding. */
  bare?: boolean;
  /** Adds a "View all" link in the header. */
  viewAllHref?: string;
  pageSize?: number;
  className?: string;
}

const POLL_MS = 8000;

export const TYPE_STYLE: Record<ActivityType, { icon: string; tone: string }> = {
  status_change: { icon: "●", tone: "text-online bg-online/12" },
  task_created: { icon: "+", tone: "text-accent bg-accent-soft" },
  task_progress: { icon: "↗", tone: "text-accent bg-accent-soft" },
  task_status: { icon: "⇄", tone: "text-break bg-break/12" },
  task_completed: { icon: "✓", tone: "text-online bg-online/12" },
  task_deleted: { icon: "×", tone: "text-danger bg-danger/12" },
  account_linked: { icon: "⛓", tone: "text-accent bg-accent-soft" },
  account_unlinked: { icon: "⛓", tone: "text-muted bg-surface-2" },
  login: { icon: "→", tone: "text-muted bg-surface-2" },
  profile_updated: { icon: "✎", tone: "text-muted bg-surface-2" },
  role_changed: { icon: "★", tone: "text-accent bg-accent-soft" },
  team_created: { icon: "◆", tone: "text-accent bg-accent-soft" },
  team_updated: { icon: "✎", tone: "text-muted bg-surface-2" },
  team_deleted: { icon: "×", tone: "text-danger bg-danger/12" },
  team_linked: { icon: "⛓", tone: "text-accent bg-accent-soft" },
  team_unlinked: { icon: "⛓", tone: "text-muted bg-surface-2" },
  member_joined: { icon: "↘", tone: "text-online bg-online/12" },
  member_left: { icon: "↖", tone: "text-break bg-break/12" },
  eod_note: { icon: "✍", tone: "text-accent bg-accent-soft" },
  user_deleted: { icon: "×", tone: "text-danger bg-danger/12" },
};

export default function ActivityLog({
  title = "Activity log",
  userId,
  taskId,
  members,
  bare = false,
  viewAllHref,
  pageSize = 25,
  className = "",
}: Props) {
  const [type, setType] = useState<ActivityType | "">("");
  const [person, setPerson] = useState("");
  const [source, setSource] = useState("");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logsRef = useRef(logs);
  logsRef.current = logs;

  const query = useCallback(
    (before?: string | null) => {
      const p = new URLSearchParams({ limit: String(pageSize) });
      const who = userId ?? person;
      if (who) p.set("user", who);
      if (taskId) p.set("task", taskId);
      if (type) p.set("type", type);
      if (source) p.set("source", source);
      if (before) p.set("before", before);
      return `/api/logs?${p}`;
    },
    [userId, taskId, person, type, source, pageSize],
  );

  // Initial load whenever filters change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<{ logs: LogRow[]; nextCursor: string | null }>(query())
      .then((r) => {
        if (cancelled) return;
        setLogs(r.logs);
        setCursor(r.nextCursor);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query]);

  // Pull in new entries on top without losing older pages the user loaded.
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await api<{ logs: LogRow[] }>(query());
        const known = new Set(logsRef.current.map((l) => l._id));
        const fresh = r.logs.filter((l) => !known.has(l._id));
        if (fresh.length) setLogs((prev) => [...fresh, ...prev]);
      } catch {
        // Keep showing what we have.
      }
    };
    const id = setInterval(refresh, POLL_MS);
    window.addEventListener(REFRESH_EVENT, refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener(REFRESH_EVENT, refresh);
    };
  }, [query]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await api<{ logs: LogRow[]; nextCursor: string | null }>(query(cursor));
      setLogs((prev) => [...prev, ...r.logs]);
      setCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className={`flex flex-col ${bare ? "" : "card"} ${className}`}>
      {bare ? (
        <h3 className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{title}</h3>
      ) : (
      <div className="border-b border-line p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <span className="flex items-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-online" /> Live
            </span>
            {viewAllHref && (
              <Link href={viewAllHref} className="font-medium text-accent hover:underline">
                View all →
              </Link>
            )}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {members && !userId && (
            <select className="input col-span-2 py-1.5" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by person">
              <option value="">Everyone</option>
              {members.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <select className="input py-1.5" value={type} onChange={(e) => setType(e.target.value as ActivityType | "")} aria-label="Filter by type">
            <option value="">All activity</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACTIVITY_LABEL[t]}
              </option>
            ))}
          </select>
          <select className="input py-1.5" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by source">
            <option value="">All sources</option>
            <option value="telegram">Telegram</option>
            <option value="web">Web</option>
            <option value="system">System</option>
          </select>
        </div>
      </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10 text-muted">
            <Spinner className="h-5 w-5" />
          </div>
        ) : error ? (
          <EmptyState>{error}</EmptyState>
        ) : !logs.length ? (
          <EmptyState>No activity yet.</EmptyState>
        ) : (
          <ol className="divide-y divide-line">
            {logs.map((log) => (
              <LogItem key={log._id} log={log} />
            ))}
          </ol>
        )}
        {cursor && !loading && (
          <div className="p-3">
            <button onClick={loadMore} className="btn-ghost w-full" disabled={loadingMore}>
              {loadingMore && <Spinner />} Load older
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function LogItem({ log, exactTime = false }: { log: LogRow; exactTime?: boolean }) {
  const style = TYPE_STYLE[log.type];
  return (
    <li className="flex gap-3 px-4 py-3">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style.tone}`}
        aria-hidden
      >
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug break-words">{log.message}</p>
        {log.rawText && (
          <p className="mt-1 line-clamp-3 rounded-md border-l-2 border-line bg-surface-2 px-2 py-1 text-xs text-muted italic break-words">
            “{log.rawText}”
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted">
          <time dateTime={log.createdAt} title={formatDateTime(log.createdAt)}>
            {exactTime
              ? new Date(log.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
              : timeAgo(log.createdAt)}
          </time>
          {exactTime && <span className="rounded bg-surface-2 px-1.5 py-px">{ACTIVITY_LABEL[log.type]}</span>}
          <SourceTag source={log.source} />
          {log.aiConfidence != null && (
            <span className="rounded bg-accent-soft px-1.5 py-px font-medium text-accent" title="AI confidence">
              AI {Math.round(log.aiConfidence * 100)}%
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
