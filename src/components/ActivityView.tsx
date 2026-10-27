"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, REFRESH_EVENT, type LogRow, type Member, type TeamSummary, type TrackerData } from "@/lib/client";
import { ACTIVITY_LABEL, ACTIVITY_TYPES, type ActivityType } from "@/lib/constants";
import { TYPE_STYLE } from "./ActivityLog";
import { Avatar, EmptyState, SourceTag, Spinner, TelegramIcon } from "./ui";

const PAGE_SIZE = 50;
const POLL_MS = 8000;

type Range = "today" | "7d" | "30d" | "all" | "custom";
const RANGES: [Range, string][] = [
  ["today", "Today"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["all", "All time"],
  ["custom", "Custom range"],
];

const SUMMARY: { type: ActivityType; label: string }[] = [
  { type: "status_change", label: "Status changes" },
  { type: "task_created", label: "Tickets created" },
  { type: "task_progress", label: "Progress updates" },
  { type: "task_completed", label: "Completed" },
];

const SOURCES: [string, string][] = [
  ["", "All"],
  ["telegram", "Telegram"],
  ["web", "Web"],
  ["system", "System"],
];

/** yyyy-mm-dd for a local date. */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeDates(range: Range): { from: string; to: string } {
  if (range === "all" || range === "custom") return { from: "", to: "" };
  const start = new Date();
  start.setDate(start.getDate() - (range === "today" ? 0 : range === "7d" ? 6 : 29));
  return { from: ymd(start), to: ymd(new Date()) };
}

/** Local day boundaries → ISO for the API. */
const startOfDayIso = (v: string) => (v ? new Date(`${v}T00:00:00`).toISOString() : "");
const endOfDayIso = (v: string) => (v ? new Date(`${v}T23:59:59.999`).toISOString() : "");

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (ymd(d) === ymd(today)) return "Today";
  if (ymd(d) === ymd(yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

export default function ActivityView() {
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [team, setTeam] = useState("");
  const [person, setPerson] = useState("");
  const [type, setType] = useState<ActivityType | "">("");
  const [source, setSource] = useState("");
  const [range, setRange] = useState<Range>("7d");
  const [from, setFrom] = useState(rangeDates("7d").from);
  const [to, setTo] = useState(rangeDates("7d").to);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [byType, setByType] = useState<Record<string, number>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logsRef = useRef(logs);
  logsRef.current = logs;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<TrackerData>("/api/tracker")
      .then((d) => {
        setMembers([...d.members].sort((a, b) => a.name.localeCompare(b.name)));
        setTeams(d.teams);
      })
      .catch(() => {});
  }, []);

  // Debounce the search box.
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  /** Filters except `type` — used for the summary cards so they stay comparable. */
  const baseParams = useMemo(() => {
    const p = new URLSearchParams();
    if (team) p.set("team", team);
    if (person) p.set("user", person);
    if (source) p.set("source", source);
    if (from) p.set("from", startOfDayIso(from));
    if (to) p.set("to", endOfDayIso(to));
    if (q) p.set("q", q);
    return p;
  }, [team, person, source, from, to, q]);

  const params = useMemo(() => {
    const p = new URLSearchParams(baseParams);
    if (type) p.set("type", type);
    return p;
  }, [baseParams, type]);

  const url = useCallback(
    (extra: Record<string, string>, base = params) => {
      const p = new URLSearchParams(base);
      for (const [k, v] of Object.entries(extra)) p.set(k, v);
      return `/api/logs?${p}`;
    },
    [params],
  );

  const loadSummary = useCallback(() => {
    api<{ byType: Record<string, number> }>(url({ summary: "1" }, baseParams))
      .then((r) => setByType(r.byType))
      .catch(() => {});
  }, [url, baseParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    scrollRef.current?.scrollTo({ top: 0 });
    api<{ logs: LogRow[]; nextCursor: string | null; total: number }>(url({ limit: String(PAGE_SIZE), count: "1" }))
      .then((r) => {
        if (cancelled) return;
        setLogs(r.logs);
        setCursor(r.nextCursor);
        setTotal(r.total);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    loadSummary();
    return () => {
      cancelled = true;
    };
  }, [url, loadSummary]);

  // Live: prepend entries that arrived since the last fetch.
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await api<{ logs: LogRow[]; total: number }>(url({ limit: String(PAGE_SIZE), count: "1" }));
        const known = new Set(logsRef.current.map((l) => l._id));
        const fresh = r.logs.filter((l) => !known.has(l._id));
        if (fresh.length) setLogs((prev) => [...fresh, ...prev]);
        setTotal(r.total);
        loadSummary();
      } catch {
        // keep current view
      }
    };
    const id = setInterval(refresh, POLL_MS);
    window.addEventListener(REFRESH_EVENT, refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener(REFRESH_EVENT, refresh);
    };
  }, [url, loadSummary]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await api<{ logs: LogRow[]; nextCursor: string | null }>(url({ limit: String(PAGE_SIZE), before: cursor }));
      setLogs((prev) => [...prev, ...r.logs]);
      setCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  function pickRange(r: Range) {
    setRange(r);
    if (r !== "custom") {
      const d = rangeDates(r);
      setFrom(d.from);
      setTo(d.to);
    }
  }

  function reset() {
    setTeam("");
    setPerson("");
    setType("");
    setSource("");
    setSearch("");
    pickRange("7d");
  }

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: LogRow[] }[] = [];
    for (const l of logs) {
      const key = ymd(new Date(l.createdAt));
      const last = out[out.length - 1];
      if (last?.key === key) last.items.push(l);
      else out.push({ key, label: dayLabel(l.createdAt), items: [l] });
    }
    return out;
  }, [logs]);

  const activeFilters = [team, person, type, source, q].filter(Boolean).length + (range !== "7d" ? 1 : 0);
  const selectedPerson = members.find((m) => m._id === person);
  const selectedTeam = teams.find((t) => t._id === team);
  const peopleList = selectedTeam ? members.filter((m) => selectedTeam.memberIds.includes(m._id)) : members;

  const sidebar = (
    <div className="space-y-6">
      <div className="relative">
        <svg viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.5 13.5 3 3" strokeLinecap="round" />
        </svg>
        <input className="input pl-8" placeholder="Search messages…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search activity" />
      </div>

      <FilterGroup title="Date">
        <div className="space-y-0.5">
          {RANGES.map(([r, label]) => (
            <SideOption key={r} active={range === r} onClick={() => pickRange(r)}>
              {label}
            </SideOption>
          ))}
        </div>
        {range === "custom" && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-muted">
              From
              <input type="date" className="input mt-1 px-2 py-1.5 text-xs" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-[11px] text-muted">
              To
              <input type="date" className="input mt-1 px-2 py-1.5 text-xs" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}
      </FilterGroup>

      {teams.length > 0 && (
        <FilterGroup title="Team">
          <div className="space-y-0.5">
            <SideOption active={!team} onClick={() => setTeam("")}>
              <span className="h-2.5 w-2.5 rounded-full border border-muted" />
              All teams
            </SideOption>
            {teams.map((t) => (
              <SideOption key={t._id} active={team === t._id} onClick={() => (setTeam(team === t._id ? "" : t._id), setPerson(""))}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                <span className="truncate">{t.name}</span>
              </SideOption>
            ))}
          </div>
        </FilterGroup>
      )}

      <FilterGroup title="Source">
        <div className="grid grid-cols-4 gap-0.5 rounded-lg bg-surface-2 p-0.5">
          {SOURCES.map(([v, label]) => (
            <button
              key={v}
              onClick={() => setSource(v)}
              className={`rounded-md py-1.5 text-[11px] font-medium transition ${source === v ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Type">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!type} onClick={() => setType("")}>
            All
          </Chip>
          {ACTIVITY_TYPES.map((t) => (
            <Chip key={t} active={type === t} onClick={() => setType(type === t ? "" : t)}>
              {ACTIVITY_LABEL[t]}
            </Chip>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="People">
        <div className="space-y-0.5">
          <SideOption active={!person} onClick={() => setPerson("")}>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs">∗</span>
            Everyone
          </SideOption>
          {peopleList.map((m) => (
            <SideOption key={m._id} active={person === m._id} onClick={() => setPerson(person === m._id ? "" : m._id)}>
              <Avatar name={m.name} size={24} presence={m.presence} />
              <span className="truncate">{m.name}</span>
            </SideOption>
          ))}
        </div>
      </FilterGroup>
    </div>
  );

  return (
    <div className="flex flex-col gap-5 lg:h-[calc(100dvh-6.5rem)]">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="mt-0.5 text-sm text-muted">Every status change, ticket update and login — with the original Telegram message.</p>
        </div>
        <button className="btn-ghost lg:hidden" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          Filters{activeFilters ? <span className="rounded-full bg-accent px-1.5 text-[11px] text-white">{activeFilters}</span> : null}
        </button>
        {activeFilters > 0 && (
          <button onClick={reset} className="btn-ghost">
            Reset
          </button>
        )}
        <a href={`/api/logs/export?${params}`} className="btn-primary" download>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Export CSV
        </a>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[264px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className={`card min-h-0 overflow-y-auto p-4 ${showFilters ? "" : "hidden"} lg:block`}>{sidebar}</aside>

        {/* Main */}
        <div className="flex min-h-0 flex-col gap-4">
          <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
            {SUMMARY.map((s) => {
              const st = TYPE_STYLE[s.type];
              const active = type === s.type;
              return (
                <button
                  key={s.type}
                  onClick={() => setType(active ? "" : s.type)}
                  aria-pressed={active}
                  className={`card group flex items-center gap-3 p-3.5 text-left transition hover:border-accent/50 ${active ? "border-accent ring-2 ring-accent/20" : ""}`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-bold ${st.tone}`}>{st.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-2xl leading-tight font-semibold tabular-nums">{byType[s.type] ?? 0}</span>
                    <span className="block truncate text-xs text-muted">{s.label}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <section className="card flex min-h-[60vh] flex-1 flex-col overflow-hidden lg:min-h-0">
            <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-online opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-online" />
                </span>
                Live timeline
              </span>
              <span className="text-xs text-muted">
                {total === null ? "…" : `${total.toLocaleString()} ${total === 1 ? "entry" : "entries"}`}
                {selectedTeam && ` · ${selectedTeam.name}`}
                {selectedPerson && ` · ${selectedPerson.name}`}
                {type && ` · ${ACTIVITY_LABEL[type]}`}
              </span>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex justify-center py-20 text-muted">
                  <Spinner className="h-6 w-6" />
                </div>
              ) : error ? (
                <EmptyState>{error}</EmptyState>
              ) : !logs.length ? (
                <div className="flex flex-col items-center gap-2 py-20 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-xl text-muted">∅</span>
                  <p className="text-sm font-medium">No activity here</p>
                  <p className="text-xs text-muted">Try a wider date range or clear some filters.</p>
                </div>
              ) : (
                <div className="px-3 pb-4 sm:px-5">
                  {groups.map((g, gi) => (
                    <div key={g.key}>
                      <div className="sticky top-0 z-10 -mx-3 bg-surface/90 px-3 py-3 backdrop-blur sm:-mx-5 sm:px-5">
                        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold">
                          {g.label}
                          <span className="font-normal text-muted">
                            {g.items.length}
                            {cursor && gi === groups.length - 1 ? "+" : ""}
                          </span>
                        </span>
                      </div>
                      <ol className="relative">
                        {g.items.map((log, i) => (
                          <TimelineItem key={log._id} log={log} last={i === g.items.length - 1} />
                        ))}
                      </ol>
                    </div>
                  ))}
                  {cursor && (
                    <button onClick={loadMore} className="btn-ghost mt-2 w-full" disabled={loadingMore}>
                      {loadingMore && <Spinner />} Load older
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function TimelineItem({ log, last }: { log: LogRow; last: boolean }) {
  const st = TYPE_STYLE[log.type];
  const who = log.user ?? log.actor;
  const time = new Date(log.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <li className="group relative grid grid-cols-[3.25rem_2rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[3.75rem_2rem_minmax(0,1fr)] sm:gap-x-3">
      <time dateTime={log.createdAt} className="pt-2 text-right text-xs tabular-nums text-muted" title={new Date(log.createdAt).toLocaleString()}>
        {time}
      </time>

      {/* rail + node */}
      <div className="relative flex justify-center">
        {!last && <span className="absolute top-8 bottom-0 w-px bg-line" aria-hidden />}
        <span className={`relative z-[1] mt-1 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ring-4 ring-surface ${st.tone}`} aria-hidden>
          {st.icon}
        </span>
      </div>

      <div className="min-w-0 pb-5">
        <div className="rounded-xl px-3 py-2 transition group-hover:bg-surface-2/70">
          <div className="flex items-start gap-2.5">
            {who && <Avatar name={who.name} size={22} />}
            <p className="min-w-0 flex-1 text-sm leading-snug break-words">{log.message}</p>
          </div>

          {log.rawText && (
            <div className="mt-2 flex items-start gap-2">
              <TelegramIcon className="mt-1.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <p className="max-w-xl rounded-2xl rounded-tl-sm bg-accent-soft px-3 py-1.5 text-[13px] break-words text-fg/90">{log.rawText}</p>
            </div>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted">
            <span className="rounded-md bg-surface-2 px-1.5 py-px font-medium">{ACTIVITY_LABEL[log.type]}</span>
            <SourceTag source={log.source} />
            {log.aiConfidence != null && (
              <span
                className={`rounded-md px-1.5 py-px font-medium ${log.aiConfidence >= 0.85 ? "bg-online/12 text-online" : "bg-break/12 text-break"}`}
                title="How sure the AI was when it read the Telegram message"
              >
                AI {Math.round(log.aiConfidence * 100)}%
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</h3>
      {children}
    </div>
  );
}

function SideOption({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
        active ? "bg-accent-soft font-medium text-accent" : "text-fg/80 hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-xs transition ${
        active ? "border-accent bg-accent text-white" : "border-line text-muted hover:border-accent/50 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
