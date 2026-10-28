"use client";

import { useEffect, useMemo, useState } from "react";
import { api, readPref, REFRESH_EVENT, writePref, type TrackerData } from "@/lib/client";
import { POSITION_LABEL, TASK_STATUS_LABEL, canViewTeamReports, type TaskStatus } from "@/lib/constants";
import type { MemberEvent, MemberRow, TeamReport, TicketDay, TicketRow } from "@/lib/reports";
import TicketHistory from "./TicketHistory";
import { Avatar, PriorityIcon, Spinner, TaskStatusBadge, TelegramIcon } from "./ui";

type Period = "day" | "week";

const TEAM_PREF = "tt.reports.team";
const PERIOD_PREF = "tt.reports.period";

// ---------- date helpers (browser-local calendar days) ----------
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const shift = (s: string, days: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + days);
  return ymd(d);
};
const fmt = (s: string, o: Intl.DateTimeFormatOptions) => parse(s).toLocaleDateString(undefined, o);
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${min}m`);

export default function ReportsView() {
  const [tracker, setTracker] = useState<TrackerData | null>(null);
  const [teamId, setTeamId] = useState<string>("");
  const [period, setPeriod] = useState<Period>("day");
  const [date, setDate] = useState(() => ymd(new Date()));
  const [data, setData] = useState<{ report: TeamReport; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTicket, setOpenTicket] = useState<TicketRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [showText, setShowText] = useState(false);
  const [tab, setTab] = useState<"overview" | "tickets" | "people">("overview");
  const [downloadOpen, setDownloadOpen] = useState(false);

  // Teams this person may report on.
  useEffect(() => {
    api<TrackerData>("/api/tracker").then((t) => {
      setTracker(t);
      const allowed = t.teams.filter((x) => canViewTeamReports(t.me, x._id));
      const fromUrl = new URLSearchParams(window.location.search).get("team");
      const saved = readPref(TEAM_PREF);
      setTeamId(
        allowed.find((x) => x._id === fromUrl)?._id ??
          allowed.find((x) => x._id === saved)?._id ??
          allowed.find((x) => t.me.teamIds.includes(x._id))?._id ??
          allowed[0]?._id ??
          "",
      );
      if (readPref(PERIOD_PREF) === "week") setPeriod("week");
    });
  }, []);

  const teams = useMemo(() => (tracker ? tracker.teams.filter((x) => canViewTeamReports(tracker.me, x._id)) : []), [tracker]);

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    const load = (quiet = false) => {
      if (!quiet) setLoading(true);
      api<{ report: TeamReport; text: string }>(`/api/reports?team=${teamId}&period=${period}&date=${date}`)
        .then((r) => {
          if (cancelled) return;
          setData(r);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
    };
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(true), 30_000);
    const onRefresh = () => load(true);
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
  }, [teamId, period, date]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  if (!tracker) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (!teams.length) {
    return (
      <div className="card mx-auto max-w-lg px-6 py-14 text-center">
        <p className="font-semibold">No teams to report on</p>
        <p className="mt-1 text-sm text-muted">Reports appear once a Manager creates a team (Team page) and you lead it.</p>
      </div>
    );
  }

  const today = ymd(new Date());
  const step = period === "day" ? 1 : 7;
  const isCurrent = period === "day" ? date === today : shift(date, -((parse(date).getDay() + 6) % 7)) === shift(today, -((new Date().getDay() + 6) % 7));
  const report = data?.report;
  const nameById = new Map((report?.members ?? []).map((m) => [m._id, m.name]));

  const choosePeriod = (p: Period) => {
    setPeriod(p);
    writePref(PERIOD_PREF, p);
  };
  const chooseTeam = (id: string) => {
    setTeamId(id);
    writePref(TEAM_PREF, id);
  };

  async function copyText() {
    if (!data) return;
    await navigator.clipboard.writeText(data.text).catch(() => {});
    setToast("Report copied");
  }

  async function postToTelegram() {
    if (!report || !confirm(`Post this ${period === "day" ? "EOD" : "EOW"} report to ${report.team.name}'s Telegram group?`)) return;
    setPosting(true);
    try {
      await api("/api/reports/post", { method: "POST", json: { team: teamId, period, date } });
      setToast("Posted to Telegram ✓");
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setPosting(false);
    }
  }

  const label =
    period === "day"
      ? fmt(date, { weekday: "long", day: "numeric", month: "long" })
      : report
        ? `${fmt(report.from, { day: "numeric", month: "short" })} – ${fmt(report.to, { day: "numeric", month: "short", year: "numeric" })}`
        : "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-0.5 text-sm text-muted">End-of-day and end-of-week summaries, and how every ticket moved — day by day, and who worked on it.</p>
        </div>
        <div className="no-print flex gap-2">
          <div className="relative">
            <button className="btn-ghost" onClick={() => setDownloadOpen((o) => !o)} disabled={!data} aria-haspopup="menu" aria-expanded={downloadOpen}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Download
            </button>
            {downloadOpen && (
              <div role="menu" className="card absolute right-0 z-30 mt-2 w-60 overflow-hidden p-1 shadow-xl" onMouseLeave={() => setDownloadOpen(false)}>
                {(
                  [
                    ["pdf", "PDF", "Tickets, people and EOD notes — ready to share"],
                    ["csv", "Spreadsheet (.csv)", "Tickets day by day, people, and each person's day"],
                    ["txt", "Text (.txt)", "Same as the Telegram message"],
                  ] as const
                ).map(([fmtKey, title, sub]) => (
                  <a
                    key={fmtKey}
                    role="menuitem"
                    href={`/api/reports/export?team=${teamId}&period=${period}&date=${date}&format=${fmtKey}`}
                    download
                    onClick={() => setDownloadOpen(false)}
                    className="block rounded-lg px-3 py-2 hover:bg-surface-2"
                  >
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="block text-[11px] text-muted">{sub}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
          <button className="btn-ghost" onClick={copyText} disabled={!data}>
            Copy text
          </button>
          <button className="btn-primary" onClick={postToTelegram} disabled={!report?.team.telegramLinked || posting} title={report?.team.telegramLinked ? undefined : "Connect the team's Telegram group first"}>
            {posting ? <Spinner /> : <TelegramIcon className="h-4 w-4" />} Post to group
          </button>
        </div>
      </div>

      {/* Controls */}
      <section className="no-print card flex flex-wrap items-center gap-3 p-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Team">
          {teams.map((t) => (
            <button
              key={t._id}
              role="tab"
              aria-selected={teamId === t._id}
              onClick={() => chooseTeam(t._id)}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${teamId === t._id ? "bg-fg text-bg" : "text-fg/80 hover:bg-surface-2"}`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-surface-2 p-0.5" role="tablist" aria-label="Period">
            {(
              [
                ["day", "EOD · Day"],
                ["week", "EOW · Week"],
              ] as [Period, string][]
            ).map(([p, l]) => (
              <button
                key={p}
                role="tab"
                aria-selected={period === p}
                onClick={() => choosePeriod(p)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${period === p ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button className="btn-ghost px-2.5 py-1.5" onClick={() => setDate(shift(date, -step))} aria-label={`Previous ${period}`}>
              ‹
            </button>
            <input type="date" className="input w-auto py-1.5 text-xs" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
            <button className="btn-ghost px-2.5 py-1.5" onClick={() => setDate(shift(date, step))} disabled={isCurrent} aria-label={`Next ${period}`}>
              ›
            </button>
            {!isCurrent && (
              <button className="btn-ghost py-1.5 text-xs" onClick={() => setDate(today)}>
                {period === "day" ? "Today" : "This week"}
              </button>
            )}
          </div>
        </div>
      </section>

      {error && <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      {!report || loading ? (
        <div className="flex justify-center py-20 text-muted">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <span className="h-3 w-3 rounded-full" style={{ background: report.team.color }} />
              {report.team.name} · {period === "day" ? "EOD" : "EOW"}
            </h2>
            <span className="text-sm text-muted">{label}</span>
            {isCurrent && <span className="no-print rounded-md bg-online/12 px-2 py-0.5 text-xs font-medium text-online">Live — still updating</span>}
            <span className="flex w-full flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {report.team.shiftStart && <span>🕘 Shift {report.team.shiftStart}–{report.team.shiftEnd}</span>}
              {report.team.lead && <span>Team Lead: <strong className="text-fg">{report.team.lead}</strong></span>}
              {report.team.manager && <span>Overseen by: <strong className="text-fg">{report.team.manager}</strong></span>}
            </span>
          </div>

          {/* KPI row — numbers in ink, colour only on the small icon */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Completed" value={report.totals.completed} dot="bg-online" />
            <Kpi label="Progress updates" value={report.totals.progressUpdates} dot="bg-accent" />
            <Kpi label="New tickets" value={report.totals.created} dot="bg-accent" />
            <Kpi label="Blocked" value={report.totals.blocked} dot="bg-danger" />
            <Kpi label="Active people" value={`${report.totals.activePeople}/${report.members.filter((m) => m.inTeam).length}`} dot="bg-online" />
            <Kpi label="EOD notes" value={report.totals.eodNotes} dot="bg-break" />
          </div>

          {report.missingEod.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 rounded-xl border border-break/40 bg-break/10 px-4 py-2.5 text-sm">
              <span aria-hidden>⏳</span>
              <strong>No EOD note yet:</strong> {report.missingEod.join(", ")}
              <span className="text-xs text-muted">— they can send “/eod …” or start a message with “EOD:” in the group.</span>
            </p>
          )}

          {/* Tabs */}
          <div className="no-print flex w-fit rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Report sections">
            {(
              [
                ["overview", "Overview"],
                ["tickets", period === "week" ? "Tickets day by day" : "Tickets"],
                ["people", period === "week" ? "People day by day" : "People's day"],
              ] as const
            ).map(([id, l]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
              >
                {l}
              </button>
            ))}
          </div>

          <div className={tab === "people" ? "" : "hidden print:block"}>
            <PeopleDays report={report} nameById={nameById} onOpenTicket={(id) => setOpenTicket(report.tickets.find((t) => t._id === id) ?? null)} />
          </div>

          {/* Ticket progress date by date */}
          <section className={`card overflow-hidden ${tab === "tickets" ? "" : "hidden print:block"}`}>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <h3 className="font-semibold">Ticket progress {period === "week" ? "— date by date" : "today"}</h3>
              <span className="text-xs text-muted">
                {report.tickets.length} ticket{report.tickets.length === 1 ? "" : "s"} touched · click one for its full history
              </span>
            </div>
            {!report.tickets.length ? (
              <p className="px-4 py-10 text-center text-sm text-muted">No ticket updates in this {period}.</p>
            ) : period === "week" ? (
              <WeekGrid report={report} nameById={nameById} onOpen={setOpenTicket} />
            ) : (
              <DayTable report={report} nameById={nameById} onOpen={setOpenTicket} />
            )}
          </section>

          {/* People */}
          <section className={tab === "overview" ? "" : "hidden print:block"}>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <h3 className="font-semibold">People</h3>
              <span className="flex items-center gap-3 text-xs text-muted" aria-label="Legend">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-sm bg-online" /> Online
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-sm bg-break" /> Break
                </span>
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {report.members.map((m) => (
                <PersonCard key={m._id} m={m} report={report} maxMinutes={Math.max(60, ...report.members.map((x) => x.onlineMinutes + x.breakMinutes))} />
              ))}
            </div>
          </section>

          {/* Telegram preview */}
          <section className={`no-print card ${tab === "overview" ? "" : "hidden"}`}>
            <button className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium" onClick={() => setShowText((s) => !s)} aria-expanded={showText}>
              <span className="flex items-center gap-2">
                <TelegramIcon className="h-4 w-4 text-accent" /> Message preview (what the bot posts)
              </span>
              <span className="text-muted">{showText ? "▲" : "▼"}</span>
            </button>
            {showText && <pre className="overflow-x-auto border-t border-line px-4 py-3 font-sans text-sm whitespace-pre-wrap">{data?.text}</pre>}
          </section>
        </>
      )}

      {openTicket && <HistoryModal ticket={openTicket} onClose={() => setOpenTicket(null)} />}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-fg px-4 py-2.5 text-sm text-bg shadow-lg" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

const EVENT_ICON: Record<MemberEvent["kind"], { icon: string; tone: string }> = {
  created: { icon: "+", tone: "bg-accent-soft text-accent" },
  progress: { icon: "↗", tone: "bg-accent-soft text-accent" },
  completed: { icon: "✓", tone: "bg-online/12 text-online" },
  status: { icon: "⇄", tone: "bg-break/12 text-break" },
  presence: { icon: "●", tone: "bg-surface-2 text-muted" },
  eod: { icon: "✍", tone: "bg-accent-soft text-accent" },
};
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—");
/** Scale for the per-day time bar: a 9-hour day fills it. */
const DAY_SCALE_MIN = 540;

function TimeBar({ online, onBreak }: { online: number; onBreak: number }) {
  const total = Math.max(DAY_SCALE_MIN, online + onBreak);
  return (
    <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2">
      {online > 0 && <span className="h-full rounded-l-full bg-online" style={{ width: `${(online / total) * 100}%` }} title={`Online ${dur(online)}`} />}
      {onBreak > 0 && <span className="h-full rounded-r-full bg-break" style={{ width: `${(onBreak / total) * 100}%` }} title={`Break ${dur(onBreak)}`} />}
    </div>
  );
}

/** Everything one person did on one day, in order. */
function DayDetail({ m, day, onOpenTicket }: { m: MemberRow; day: string; onOpenTicket: (id: string) => void }) {
  const d = m.days[day];
  if (!d) return <p className="text-sm text-muted">No activity on this day.</p>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          First online <strong className="text-fg">{clock(d.firstOnline)}</strong>
          {d.lateBy && <span className="ml-1.5 rounded bg-danger/12 px-1.5 py-px font-semibold text-danger">⏰ {d.lateBy}m late</span>}
        </span>
        <span>
          Online <strong className="text-fg">{dur(d.onlineMinutes)}</strong> · Break <strong className="text-fg">{dur(d.breakMinutes)}</strong>
        </span>
        <span>
          Last active <strong className="text-fg">{clock(d.lastActive)}</strong>
        </span>
      </div>
      {d.events.length ? (
        <ol className="space-y-1.5 border-l-2 border-line pl-3">
          {d.events.map((e, i) => {
            const st = EVENT_ICON[e.kind];
            return (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="w-12 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-muted">{clock(e.at)}</span>
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${st.tone}`} aria-hidden>
                  {st.icon}
                </span>
                <span className="min-w-0 flex-1 break-words">
                  {e.ticket && (
                    <button onClick={() => onOpenTicket(e.ticket!._id)} className="mr-1 font-medium hover:text-accent">
                      <span className="font-mono text-[11px] text-muted">{e.ticket.key}</span> {e.ticket.title}
                    </button>
                  )}
                  <span className={e.kind === "eod" ? "italic" : e.ticket ? "text-muted" : ""}>{e.kind === "eod" ? `EOD: “${e.text}”` : e.text}</span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted">Online, but no ticket updates.</p>
      )}
    </div>
  );
}

function PeopleDays({ report, onOpenTicket }: { report: TeamReport; nameById: Map<string, string>; onOpenTicket: (id: string) => void }) {
  const [sel, setSel] = useState<{ id: string; day: string } | null>(null);
  const todayKey = ymd(new Date());
  const people = report.members;
  const selected = sel ? people.find((p) => p._id === sel.id) : null;

  if (report.period === "day") {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        {people.map((m) => (
          <article key={m._id} className="card p-4">
            <div className="mb-3 flex items-center gap-3">
              <Avatar name={m.name} id={m._id} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.name}</p>
                <p className="truncate text-xs text-muted">{m.position ? POSITION_LABEL[m.position] : "No role"}</p>
              </div>
              <div className="w-28">
                <TimeBar online={m.days[report.from]?.onlineMinutes ?? 0} onBreak={m.days[report.from]?.breakMinutes ?? 0} />
              </div>
            </div>
            <DayDetail m={m} day={report.from} onOpenTicket={onOpenTicket} />
          </article>
        ))}
      </div>
    );
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3">
        <h3 className="font-semibold">Each person, day by day</h3>
        <span className="text-xs text-muted">Click a day to see exactly what they did</span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted" aria-label="Legend">
          <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-online" /> Online</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-break" /> Break</span>
          <span>⏰ late start</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] tracking-wide text-muted uppercase">
              <th className="sticky left-0 z-[1] bg-surface px-4 py-2 text-left font-medium">Person</th>
              {report.days.map((d) => (
                <th key={d} className={`px-1.5 py-2 text-center font-medium ${d === todayKey ? "text-fg" : ""}`}>
                  {fmt(d, { weekday: "short" })}
                  <span className="block font-normal normal-case">{fmt(d, { day: "numeric", month: "short" })}</span>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Week</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {people.map((m) => (
              <tr key={m._id}>
                <td className="sticky left-0 z-[1] bg-surface px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar name={m.name} id={m._id} size={24} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.name}</p>
                      <p className="truncate text-[11px] text-muted">{m.position ? POSITION_LABEL[m.position] : "No role"}</p>
                    </div>
                  </div>
                </td>
                {report.days.map((d) => {
                  const day = m.days[d];
                  const active = sel?.id === m._id && sel.day === d;
                  if (d > todayKey || !day) return <td key={d} className="px-1.5 py-2 text-center text-xs text-muted/50">—</td>;
                  const actions = day.events.filter((e) => e.kind !== "presence").length;
                  const done = day.events.filter((e) => e.kind === "completed").length;
                  return (
                    <td key={d} className="px-1 py-1.5">
                      <button
                        onClick={() => setSel(active ? null : { id: m._id, day: d })}
                        aria-pressed={active}
                        title={`${m.name} · ${fmt(d, { weekday: "short", day: "numeric", month: "short" })}: online ${dur(day.onlineMinutes)}, ${actions} ticket actions`}
                        className={`flex w-full flex-col gap-1 rounded-lg px-1.5 py-1.5 text-left transition ${active ? "bg-accent-soft ring-2 ring-accent" : "hover:bg-surface-2"}`}
                      >
                        <span className="text-[11px] font-semibold tabular-nums">{dur(day.onlineMinutes)}</span>
                        <TimeBar online={day.onlineMinutes} onBreak={day.breakMinutes} />
                        <span className="flex items-center gap-1 text-[10px] text-muted tabular-nums">
                          {actions} act{done ? <span className="text-online">· {done}✓</span> : null}
                          {day.lateBy ? <span className="font-semibold text-danger">⏰</span> : null}
                        </span>
                      </button>
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right text-xs tabular-nums">
                  <p className="font-semibold">{dur(m.onlineMinutes)}</p>
                  <p className="text-muted">{m.completed.length} done{m.lateDays ? ` · ${m.lateDays}× late` : ""}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && sel && (
        <div className="border-t border-line bg-surface-2/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Avatar name={selected.name} id={selected._id} size={24} />
            <h4 className="font-semibold">
              {selected.name} · {fmt(sel.day, { weekday: "long", day: "numeric", month: "short" })}
            </h4>
            <button className="ml-auto text-xs text-muted hover:text-fg" onClick={() => setSel(null)}>
              Close ✕
            </button>
          </div>
          <DayDetail m={selected} day={sel.day} onOpenTicket={onOpenTicket} />
        </div>
      )}
      {/* For the PDF: every person's days, written out */}
      <div className="hidden space-y-4 p-4 print:block">
        {people.map((m) =>
          report.days
            .filter((d) => m.days[d])
            .map((d) => (
              <div key={`${m._id}${d}`} className="break-inside-avoid">
                <h4 className="mb-1 text-sm font-semibold">
                  {m.name} · {fmt(d, { weekday: "long", day: "numeric", month: "short" })}
                </h4>
                <DayDetail m={m} day={d} onOpenTicket={() => {}} />
              </div>
            )),
        )}
      </div>
    </section>
  );
}

function Kpi({ label, value, dot }: { label: string; value: number | string; dot: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Who({ ids, nameById, max = 3 }: { ids: string[]; nameById: Map<string, string>; max?: number }) {
  if (!ids.length) return <span className="text-xs text-muted">—</span>;
  const names = ids.map((id) => nameById.get(id) ?? "Someone");
  return (
    <span className="flex items-center -space-x-1.5" title={names.join(", ")}>
      {names.slice(0, max).map((n, i) => (
        <span key={i} className="rounded-full ring-2 ring-surface">
          <Avatar name={n} id={ids[i]} size={20} />
        </span>
      ))}
      {names.length > max && <span className="pl-2.5 text-[11px] text-muted">+{names.length - max}</span>}
    </span>
  );
}

function TicketCell({ t, onOpen }: { t: TicketRow; onOpen: (t: TicketRow) => void }) {
  return (
    <button onClick={() => onOpen(t)} className="flex min-w-0 items-center gap-2 text-left hover:text-accent">
      <span className="font-mono text-[11px] font-semibold text-muted">{t.key}</span>
      <span className="truncate font-medium">{t.title}</span>
      <PriorityIcon priority={t.priority} />
    </button>
  );
}

/** Start → end bar: the part held at the start, plus the part gained this period (2px gap between). */
function DeltaBar({ start, end, status }: { start: number; end: number; status: TaskStatus }) {
  const gained = Math.max(0, end - start);
  const base = Math.min(start, end);
  const color = status === "done" ? "bg-online" : status === "blocked" ? "bg-danger" : "bg-accent";
  return (
    <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2" title={`${start}% → ${end}%`}>
      {base > 0 && <span className={`h-full ${color} opacity-35`} style={{ width: `${base}%` }} />}
      {gained > 0 && <span className={`h-full rounded-r-full ${color}`} style={{ width: `${gained}%` }} />}
    </div>
  );
}

function DayTable({ report, nameById, onOpen }: { report: TeamReport; nameById: Map<string, string>; onOpen: (t: TicketRow) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] tracking-wide text-muted uppercase">
            <th className="px-4 py-2 font-medium">Ticket</th>
            <th className="px-3 py-2 font-medium">Assignee</th>
            <th className="w-56 px-3 py-2 font-medium">Progress today</th>
            <th className="px-3 py-2 font-medium">Worked on by</th>
            <th className="px-4 py-2 text-right font-medium">Now</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {report.tickets.map((t) => (
            <tr key={t._id} className="hover:bg-surface-2/50">
              <td className="max-w-80 px-4 py-2.5">
                <TicketCell t={t} onOpen={onOpen} />
                {t.isNew && <span className="text-[11px] text-accent">new today</span>}
              </td>
              <td className="px-3 py-2.5 text-xs">{t.assignee?.name ?? <span className="text-muted">—</span>}</td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <DeltaBar start={t.start} end={t.end} status={t.status} />
                  <span className="shrink-0 text-xs tabular-nums">
                    {t.start}% → <strong>{t.end}%</strong>
                  </span>
                </div>
              </td>
              <td className="px-3 py-2.5">
                <Who ids={t.contributors.map((c) => c._id)} nameById={nameById} />
              </td>
              <td className="px-4 py-2.5 text-right">
                <TaskStatusBadge status={t.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeekGrid({ report, nameById, onOpen }: { report: TeamReport; nameById: Map<string, string>; onOpen: (t: TicketRow) => void }) {
  const todayKey = ymd(new Date());
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] tracking-wide text-muted uppercase">
            <th className="sticky left-0 z-[1] bg-surface px-4 py-2 text-left font-medium">Ticket</th>
            {report.days.map((d) => (
              <th key={d} className={`px-1.5 py-2 text-center font-medium ${d === todayKey ? "text-fg" : ""}`}>
                {fmt(d, { weekday: "short" })}
                <span className="block font-normal normal-case">{fmt(d, { day: "numeric", month: "short" })}</span>
              </th>
            ))}
            <th className="px-3 py-2 text-left font-medium">Worked on by</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {report.tickets.map((t) => (
            <tr key={t._id}>
              <td className="sticky left-0 z-[1] max-w-64 bg-surface px-4 py-2">
                <TicketCell t={t} onOpen={onOpen} />
                <span className="text-[11px] text-muted">
                  {t.start}% → {t.end}% · {t.assignee?.name ?? "unassigned"}
                </span>
              </td>
              {report.days.map((d, i) => (
                <DayCell
                  key={d}
                  day={d}
                  cell={t.days[d]}
                  prev={i ? t.days[report.days[i - 1]] : undefined}
                  start={t.start}
                  future={d > todayKey}
                  nameById={nameById}
                  onClick={() => onOpen(t)}
                />
              ))}
              <td className="px-3 py-2">
                <Who ids={t.contributors.map((c) => c._id)} nameById={nameById} max={4} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayCell({
  day,
  cell,
  prev,
  start,
  future,
  nameById,
  onClick,
}: {
  day: string;
  cell: TicketDay;
  prev?: TicketDay;
  start: number;
  future: boolean;
  nameById: Map<string, string>;
  onClick: () => void;
}) {
  if (future || cell.notYet) return <td className="px-1.5 py-2 text-center text-xs text-muted/50">—</td>;
  const before = prev && !prev.notYet ? prev.progress : start;
  const who = cell.by.map((id) => nameById.get(id) ?? "Someone");
  const tip = `${fmt(day, { weekday: "short", day: "numeric", month: "short" })} · ${TASK_STATUS_LABEL[cell.status]} · ${
    cell.changed ? `${before}% → ${cell.progress}%${who.length ? ` · by ${who.join(", ")}` : ""}` : `${cell.progress}% (no change)`
  }`;
  const color = cell.status === "done" ? "bg-online" : cell.status === "blocked" ? "bg-danger" : "bg-accent";
  return (
    <td className="px-1 py-1.5">
      <button
        onClick={onClick}
        title={tip}
        className={`flex w-full flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition ${cell.changed ? "bg-accent-soft/70 ring-1 ring-accent/30 hover:ring-accent" : "hover:bg-surface-2"}`}
      >
        <span className={`text-xs tabular-nums ${cell.changed ? "font-semibold" : "text-muted"}`}>
          {cell.status === "done" ? "✓" : `${cell.progress}%`}
        </span>
        <span className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <span className={`block h-full rounded-full ${color} ${cell.changed ? "" : "opacity-35"}`} style={{ width: `${cell.progress}%` }} />
        </span>
        {cell.by.length > 0 ? <Who ids={cell.by} nameById={nameById} max={2} /> : <span className="h-5" />}
      </button>
    </td>
  );
}

function PersonCard({ m, report, maxMinutes }: { m: MemberRow; report: TeamReport; maxMinutes: number }) {
  const idle = !m.events && !m.eodNotes.length;
  const missing = report.missingEod.includes(m.name);
  return (
    <article className={`card flex flex-col p-4 ${idle ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <Avatar name={m.name} id={m._id} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{m.name}</p>
          <p className="truncate text-xs text-muted">
            {m.position ? POSITION_LABEL[m.position] : "No role"}
            {!m.inTeam && " · outside the team"}
            {report.period === "day" && m.days[report.from]?.lateBy ? (
              <span className="ml-1.5 rounded bg-danger/12 px-1.5 py-px text-[10px] font-semibold text-danger">⏰ {m.days[report.from]!.lateBy}m late</span>
            ) : report.period === "week" && m.lateDays ? (
              <span className="ml-1.5 rounded bg-danger/12 px-1.5 py-px text-[10px] font-semibold text-danger">⏰ late {m.lateDays}×</span>
            ) : null}
          </p>
        </div>
        <div className="text-right text-xs">
          <p className="tabular-nums">
            <strong>{m.completed.length}</strong> done
          </p>
          <p className="text-muted tabular-nums">{m.events} ticket actions</p>
        </div>
      </div>

      {/* Online / break time, scaled to the busiest person */}
      <div className="mt-3">
        <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2">
          {m.onlineMinutes > 0 && (
            <span className="h-full rounded-l-full bg-online" style={{ width: `${(m.onlineMinutes / maxMinutes) * 100}%` }} title={`Online ${dur(m.onlineMinutes)}`} />
          )}
          {m.breakMinutes > 0 && (
            <span className="h-full rounded-r-full bg-break" style={{ width: `${(m.breakMinutes / maxMinutes) * 100}%` }} title={`Break ${dur(m.breakMinutes)}`} />
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted">
          Online {dur(m.onlineMinutes)} · Break {dur(m.breakMinutes)}
          {report.period === "week" && ` · active ${m.activeDays.length}/${report.workDays} days`}
        </p>
      </div>

      {(m.completed.length > 0 || m.progressed.length > 0 || m.created.length > 0 || m.blocked.length > 0) && (
        <ul className="mt-3 space-y-1 text-xs">
          {m.completed.map((t) => (
            <li key={`c${t._id}`} className="flex gap-1.5">
              <span className="text-online">✓</span>
              <span className="truncate">
                <span className="font-mono text-muted">{t.key}</span> {t.title}
              </span>
            </li>
          ))}
          {m.progressed
            .filter((p) => !m.completed.some((c) => c._id === p._id))
            .map((t) => (
              <li key={`p${t._id}`} className="flex gap-1.5">
                <span className="text-accent">↗</span>
                <span className="truncate">
                  <span className="font-mono text-muted">{t.key}</span> {t.title}{" "}
                  <span className="tabular-nums text-muted">
                    {t.from}% → {t.to}%
                  </span>
                </span>
              </li>
            ))}
          {m.blocked.map((t) => (
            <li key={`b${t._id}`} className="flex gap-1.5">
              <span className="text-danger">⛔</span>
              <span className="truncate">
                <span className="font-mono text-muted">{t.key}</span> {t.title}
              </span>
            </li>
          ))}
          {m.created.length > 0 && (
            <li className="text-muted">
              + created {m.created.length} ticket{m.created.length === 1 ? "" : "s"}
            </li>
          )}
        </ul>
      )}

      {m.eodNotes.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {m.eodNotes.map((n, i) => (
            <blockquote key={i} className="rounded-xl rounded-tl-sm bg-accent-soft px-3 py-2 text-xs leading-relaxed">
              <span className="mb-0.5 block text-[10px] font-semibold tracking-wide text-muted uppercase">
                EOD · {new Date(n.at).toLocaleString(undefined, { weekday: report.period === "week" ? "short" : undefined, hour: "2-digit", minute: "2-digit" })}
              </span>
              {n.text}
            </blockquote>
          ))}
        </div>
      ) : missing ? (
        <p className="mt-3 rounded-lg border border-dashed border-break/50 px-3 py-1.5 text-xs text-muted">⏳ No EOD note yet</p>
      ) : idle ? (
        <p className="mt-3 text-xs text-muted">No updates in this {report.period}.</p>
      ) : null}
    </article>
  );
}

function HistoryModal({ ticket, onClose }: { ticket: TicketRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="hist-title" className="card flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-b-none shadow-2xl sm:rounded-xl">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs font-semibold text-muted">{ticket.key}</p>
            <h2 id="hist-title" className="truncate font-semibold">
              {ticket.title}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <TaskStatusBadge status={ticket.status} />
              {ticket.assignee ? `Assigned to ${ticket.assignee.name}` : "Unassigned"}
              {ticket.contributors.length > 0 && <> · worked on by {ticket.contributors.map((c) => `${c.name} (${c.events})`).join(", ")}</>}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          <TicketHistory taskId={ticket._id} />
        </div>
      </div>
    </div>
  );
}
