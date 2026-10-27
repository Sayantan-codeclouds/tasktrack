"use client";

import { useEffect, useMemo, useState } from "react";
import { api, REFRESH_EVENT, type LogRow } from "@/lib/client";
import { ACTIVITY_LABEL } from "@/lib/constants";
import { TYPE_STYLE } from "./ActivityLog";
import { Avatar, SourceTag, Spinner, TelegramIcon } from "./ui";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A ticket's full history, grouped by day, showing who did what and how progress moved. */
export default function TicketHistory({ taskId }: { taskId: string }) {
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api<{ logs: LogRow[] }>(`/api/logs?task=${taskId}&limit=100`)
        .then((r) => !cancelled && setLogs(r.logs))
        .catch((e) => !cancelled && setError(e.message));
    load();
    window.addEventListener(REFRESH_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(REFRESH_EVENT, load);
    };
  }, [taskId]);

  const days = useMemo(() => {
    const out: { key: string; label: string; items: LogRow[]; people: Map<string, string>; from?: number; to?: number }[] = [];
    // Oldest → newest so progress reads left to right within a day.
    for (const l of [...(logs ?? [])].reverse()) {
      const d = new Date(l.createdAt);
      const key = ymd(d);
      let g = out[out.length - 1];
      if (g?.key !== key) {
        g = { key, label: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }), items: [], people: new Map() };
        out.push(g);
      }
      g.items.push(l);
      const who = l.meta?.byAdmin ? null : (l.actor ?? l.user);
      if (who) g.people.set(who._id, who.name);
      const meta = l.meta;
      if (l.type === "task_progress" && typeof meta?.from === "number" && typeof meta?.to === "number") {
        g.from ??= meta.from;
        g.to = meta.to;
      } else if (l.type === "task_completed") {
        g.from ??= (meta?.from as { progress?: number } | undefined)?.progress;
        g.to = 100;
      } else if (l.type === "task_created") {
        g.from ??= typeof meta?.progress === "number" ? meta.progress : 0;
        g.to ??= g.from;
      }
    }
    return out.reverse(); // newest day first
  }, [logs]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!logs) {
    return (
      <div className="flex justify-center py-6 text-muted">
        <Spinner />
      </div>
    );
  }
  if (!logs.length) return <p className="py-4 text-sm text-muted">No history yet.</p>;

  return (
    <ol className="space-y-4">
      {days.map((d) => (
        <li key={d.key}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-semibold">{d.label}</span>
            {d.from !== undefined && d.to !== undefined && d.to !== d.from && (
              <span className="text-xs font-medium tabular-nums text-muted">
                {d.from}% → <span className="text-fg">{d.to}%</span>
              </span>
            )}
            <span className="ml-auto flex items-center gap-1" title={`Worked on by ${[...d.people.values()].join(", ")}`}>
              {[...d.people.entries()].slice(0, 4).map(([id, name]) => (
                <Avatar key={id} name={name} size={20} />
              ))}
              <span className="text-[11px] text-muted">{[...d.people.values()].join(", ")}</span>
            </span>
          </div>
          <ul className="space-y-1.5 border-l-2 border-line pl-3">
            {d.items.map((l) => {
              const st = TYPE_STYLE[l.type];
              return (
                <li key={l._id} className="text-sm">
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${st.tone}`} aria-hidden>
                      {st.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="leading-snug break-words">{l.message}</p>
                      {l.rawText && (
                        <p className="mt-1 flex items-start gap-1.5 text-xs text-muted italic">
                          <TelegramIcon className="mt-0.5 h-3 w-3 shrink-0 text-accent" /> “{l.rawText}”
                        </p>
                      )}
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                        {new Date(l.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        <span>{ACTIVITY_LABEL[l.type]}</span>
                        <SourceTag source={l.source} />
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
