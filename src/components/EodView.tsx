"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, readPref, timeAgo, writePref } from "@/lib/client";
import { POSITION_GROUP, POSITION_LABEL, type Position } from "@/lib/constants";
import type { EodContent, EodPage, EodTaskRow } from "@/lib/eod";
import { Avatar, Spinner, TaskStatusBadge } from "./ui";

type Period = "day" | "week";
type Person = { _id: string; name: string; position: Position | null; me: boolean };

const PERIOD_PREF = "tt.eod.period";
/** "Viewing" value for everyone's EODs and current tasks (Team Leads and Managers). */
const EVERYONE = "all";

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
const monday = (s: string) => shift(s, -((parse(s).getDay() + 6) % 7));
// One fixed style ("Tuesday, 27 October 2026"), the same as the PDF.
const fmt = (s: string, o: Intl.DateTimeFormatOptions) => parse(s).toLocaleDateString("en-GB", o);
const noop = () => () => {};
/** False while rendering on the server: "today" there can be a different day from the viewer's. */
const useInBrowser = () => useSyncExternalStore(noop, () => true, () => false);
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${min}m`);

const EMPTY_ROW: EodTaskRow = { ticket: "", title: "", status: "", progress: "", remarks: "" };
const STATUS_OPTIONS = ["To do", "In progress", "Blocked", "Done"];

export default function EodView() {
  const [period, setPeriod] = useState<Period>("day");
  const [date, setDate] = useState(() => ymd(new Date()));
  const [page, setPage] = useState<EodPage | null>(null);
  const [content, setContent] = useState<EodContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"load" | "save" | "reset" | "pdf" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Whose report is open ("" = mine). Team Leads and Managers can open their people's, read-only. */
  const [viewUser, setViewUser] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [everyone, setEveryone] = useState<EodPage[] | null>(null);
  /** Managers start on everyone's view — once, so picking "Me" afterwards sticks. */
  const picked = useRef(false);
  const inBrowser = useInBrowser();
  const all = viewUser === EVERYONE;

  useEffect(() => {
    if (readPref(PERIOD_PREF) === "week") setPeriod("week");
  }, []);

  const show = useCallback((p: EodPage) => {
    setPage(p);
    setContent(p.content);
    setDirty(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBusy("load");
    setError(null);
    const forUser = viewUser && viewUser !== EVERYONE ? `&user=${viewUser}` : "";
    Promise.all([
      api<{ page: EodPage; people: Person[]; readOnly: boolean }>(`/api/eod?period=${period}&date=${date}${forUser}`),
      viewUser === EVERYONE ? api<{ pages: EodPage[] }>(`/api/eod/everyone?period=${period}&date=${date}`) : null,
    ])
      .then(([r, e]) => {
        if (cancelled) return;
        show(r.page);
        setPeople(r.people);
        setReadOnly(r.readOnly || !!e);
        setEveryone(e?.pages ?? null);
        const me = r.people.find((p) => p.me);
        if (!picked.current && !viewUser && r.people.length > 1 && me?.position && POSITION_GROUP[me.position] === "management") {
          setViewUser(EVERYONE);
        }
        picked.current = true;
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
    };
  }, [period, date, viewUser, show]);

  // Don't lose edits by closing the tab.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const leave = () => !dirty || confirm("You have unsaved changes. Leave without saving?");
  const go = (next: { period?: Period; date?: string; user?: string }) => {
    if (!leave()) return;
    if (next.user !== undefined) setViewUser(next.user);
    if (next.period) {
      setPeriod(next.period);
      writePref(PERIOD_PREF, next.period);
    }
    if (next.date) setDate(next.date);
  };

  const edit = (patch: Partial<EodContent>) => {
    setContent((c) => (c ? { ...c, ...patch } : c));
    setDirty(true);
  };
  const editRow = (i: number, patch: Partial<EodTaskRow>) => edit({ tasks: content!.tasks.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  async function save() {
    if (!content) return null;
    setBusy("save");
    setError(null);
    try {
      const r = await api<{ page: EodPage }>("/api/eod", { method: "PUT", json: { period, date, content } });
      show(r.page);
      setToast(`${period === "day" ? "EOD" : "EOW"} saved`);
      return r.page;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!confirm(`Throw away your edits and go back to the automatic ${period === "day" ? "EOD" : "EOW"}?`)) return;
    setBusy("reset");
    try {
      const r = await api<{ page: EodPage }>(`/api/eod?period=${period}&date=${date}`, { method: "DELETE" });
      show(r.page);
      setToast("Back to the automatic version");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function download(format: "pdf" | "csv") {
    // Downloads are made from what's saved, so save first.
    if (!readOnly && dirty && !(await save())) return;
    setBusy("pdf");
    window.location.href = all
      ? `/api/eod/everyone?period=${period}&date=${date}&format=${format}`
      : `/api/eod/pdf?period=${period}&date=${date}${viewUser ? `&user=${viewUser}` : ""}&format=${format}`;
    // Only your own PDF counts as downloaded for HR.
    if (!readOnly && format === "pdf") setPage((p) => (p ? { ...p, downloadedAt: new Date().toISOString() } : p));
    setTimeout(() => setBusy(null), 1500);
  }

  if (!inBrowser) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const today = ymd(new Date());
  const isCurrent = period === "day" ? date === today : monday(date) === monday(today);
  const step = period === "day" ? 1 : 7;
  const label =
    period === "day"
      ? fmt(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : page
        ? `${fmt(page.from, { day: "numeric", month: "short" })} – ${fmt(page.to, { day: "numeric", month: "short", year: "numeric" })}`
        : "";
  const kind = period === "day" ? "EOD" : "EOW";
  const viewing = people.find((p) => (viewUser ? p._id === viewUser : p.me));
  const others = people.filter((p) => !p.me);
  /** Managers' own EOD is their teams' work. */
  const overseer = !!viewing?.position && ["management", "lead"].includes(POSITION_GROUP[viewing.position]);

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">EOD / EOW</h1>
          <p className="mt-0.5 text-sm text-muted">
            {all
              ? `Everyone's ${kind} and current tasks — ${others.length} ${others.length === 1 ? "person" : "people"}.`
              : readOnly
              ? `${viewing?.name ?? "This person"}'s end-of-day and end-of-week report — read-only.`
              : "Your end-of-day and end-of-week report. Filled in automatically — edit it, save, and download the PDF for HR."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {people.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted">Viewing</span>
              <select className="input w-auto py-1.5" value={viewUser} onChange={(e) => go({ user: e.target.value })} aria-label="Whose report">
                <option value={EVERYONE}>Everyone — {kind} &amp; current tasks</option>
                {people.map((p) => (
                  <option key={p._id} value={p.me ? "" : p._id}>
                    {p.me ? `Me (${p.name})` : p.name}
                    {p.position ? ` — ${POSITION_LABEL[p.position]}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <DownloadMenu onPick={download} disabled={!content || busy !== null} busy={busy === "pdf"} label={all ? `Download everyone's ${kind}` : "Download"} />
        </div>
      </div>

      {/* Period + date */}
      <section className="card flex flex-wrap items-center gap-3 p-3">
        <div className="flex rounded-lg bg-surface-2 p-0.5" role="tablist" aria-label="Report">
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
              onClick={() => period !== p && go({ period: p })}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${period === p ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-ghost px-2.5 py-1.5" onClick={() => go({ date: shift(date, -step) })} aria-label={`Previous ${period}`}>
            ‹
          </button>
          <input type="date" className="input w-auto py-1.5 text-xs" value={date} max={today} onChange={(e) => e.target.value && go({ date: e.target.value })} aria-label="Date" />
          <button className="btn-ghost px-2.5 py-1.5" onClick={() => go({ date: shift(date, step) })} disabled={isCurrent} aria-label={`Next ${period}`}>
            ›
          </button>
          {!isCurrent && (
            <button className="btn-ghost py-1.5 text-xs" onClick={() => go({ date: today })}>
              {period === "day" ? "Today" : "This week"}
            </button>
          )}
        </div>
        <p className="text-sm font-medium sm:ml-auto">{label}</p>
      </section>

      {error && <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      {!page || !content || busy === "load" ? (
        <div className="flex justify-center py-20 text-muted">
          <Spinner className="h-6 w-6" />
        </div>
      ) : all ? (
        <Everyone pages={everyone ?? []} period={period} kind={kind} onOpen={(id) => go({ user: id })} />
      ) : (
        <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-6 border-0 p-0">
          {readOnly ? (
            <p className="rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm">
              👁 You&apos;re viewing <strong>{viewing?.name}</strong>&apos;s {kind} —{" "}
              {page.saved ? `saved by them ${timeAgo(page.updatedAt)}` : "not saved yet, so this is the automatic version"}. Only they can edit it.
            </p>
          ) : (
            <StatusLine page={page} dirty={dirty} kind={kind} />
          )}
          <p
            className={`flex flex-wrap items-center gap-x-2 rounded-xl border px-4 py-2.5 text-sm ${
              page.downloadedAt ? "border-line bg-surface" : "border-break/40 bg-break/10"
            }`}
          >
            <span aria-hidden>📤</span>
            {page.downloadedAt ? (
              <span>
                PDF downloaded {readOnly ? "by them " : ""}
                <strong>{timeAgo(page.downloadedAt)}</strong>
                {readOnly ? "." : " — upload it to the HR portal if you haven't yet."}
              </span>
            ) : readOnly ? (
              <span>They haven&apos;t downloaded this {kind} PDF yet.</span>
            ) : (
              <span>
                <strong>Not downloaded yet.</strong> Download the PDF and upload it to the HR portal.
              </span>
            )}
          </p>

          {/* Attendance */}
          <section className="card p-4">
            <h2 className="font-semibold">Attendance</h2>
            <p className="text-xs text-muted">
              From your Online / Break / Offline status{page.shift ? ` · shift ${page.shift.start}–${page.shift.end}` : ""}.
            </p>
            {period === "day" ? (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <TimeField label="Login" value={content.login} auto={page.draft.login} onChange={(v) => edit({ login: v })} />
                <TimeField label="Logout" value={content.logout} auto={page.draft.logout} onChange={(v) => edit({ logout: v })} />
                <Fact label="Online" value={dur(page.attendance[0]?.onlineMinutes ?? 0)} />
                <Fact label="Break" value={dur(page.attendance[0]?.breakMinutes ?? 0)} />
                <Fact label="Late by" value={page.attendance[0]?.lateBy ? dur(page.attendance[0].lateBy) : "On time"} />
              </div>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <Fact label="Days active" value={`${page.totals.activeDays}/${page.totals.workDays}`} />
                  <Fact label="Online" value={dur(page.totals.onlineMinutes)} />
                  <Fact label="Break" value={dur(page.totals.breakMinutes)} />
                  <Fact label="Late days" value={String(page.totals.lateDays)} />
                  <Fact label="Tickets done" value={String(page.totals.completed)} />
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] tracking-wide text-muted uppercase">
                        <th className="py-2 pr-3 font-medium">Day</th>
                        <th className="px-3 py-2 font-medium">Login</th>
                        <th className="px-3 py-2 font-medium">Logout</th>
                        <th className="px-3 py-2 text-right font-medium">Online</th>
                        <th className="px-3 py-2 text-right font-medium">Break</th>
                        <th className="py-2 pl-3 text-right font-medium">Late</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {page.attendance.map((a) => (
                        <tr key={a.day} className={a.workDay ? "" : "text-muted"}>
                          <td className="py-2 pr-3">
                            <button className="hover:text-accent hover:underline" onClick={() => go({ period: "day", date: a.day })} title="Open this day's EOD">
                              {fmt(a.day, { weekday: "short", day: "numeric", month: "short" })}
                            </button>
                          </td>
                          <td className="px-3 py-2 tabular-nums">{a.login || "—"}</td>
                          <td className="px-3 py-2 tabular-nums">{a.logout || "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{a.onlineMinutes ? dur(a.onlineMinutes) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{a.breakMinutes ? dur(a.breakMinutes) : "—"}</td>
                          <td className="py-2 pl-3 text-right tabular-nums">{a.lateBy ? dur(a.lateBy) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <TextSection
            title={period === "day" ? "Summary of the day" : "Summary of the week"}
            hint={
              period === "day"
                ? "Starts from your Telegram EOD notes, or what you did on tickets."
                : "Built from this week's EODs — save a day's EOD to include your edits here."
            }
            value={content.summary}
            auto={page.draft.summary}
            rows={6}
            onChange={(v) => edit({ summary: v })}
          />

          {/* Tasks */}
          <section className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-semibold">{overseer ? "Team tasks" : period === "day" ? "Tasks worked on" : "Tasks this week"}</h2>
                <p className="text-xs text-muted">
                  {overseer
                    ? "Your teams' open tickets, and what was done and by whom. Add meetings, reviews or calls too."
                    : "From your tickets. Add anything that wasn't a ticket (meetings, reviews, calls)."}
                </p>
              </div>
              {JSON.stringify(content.tasks) !== JSON.stringify(page.draft.tasks) && (
                <button className="text-xs text-muted hover:text-accent" onClick={() => edit({ tasks: page.draft.tasks })}>
                  Use automatic list
                </button>
              )}
            </div>
            <div className="mt-3 hidden grid-cols-[88px_minmax(0,1fr)_120px_110px_minmax(0,0.8fr)_32px] gap-2 px-1 text-[11px] tracking-wide text-muted uppercase sm:grid">
              <span>Ticket</span>
              <span>Task</span>
              <span>Status</span>
              <span>Progress</span>
              <span>Remarks</span>
              <span />
            </div>
            <ul className="mt-1 space-y-2">
              {content.tasks.map((r, i) => (
                <li
                  key={i}
                  className="grid grid-cols-2 gap-2 rounded-lg border border-line p-2 sm:grid-cols-[88px_minmax(0,1fr)_120px_110px_minmax(0,0.8fr)_32px] sm:border-0 sm:p-0"
                >
                  <input className="input py-1.5 text-sm" placeholder="TT-12" aria-label="Ticket" value={r.ticket} onChange={(e) => editRow(i, { ticket: e.target.value })} maxLength={40} />
                  <input
                    className="input col-span-2 row-start-2 py-1.5 text-sm sm:col-span-1 sm:row-start-auto"
                    placeholder="What you worked on"
                    aria-label="Task"
                    value={r.title}
                    onChange={(e) => editRow(i, { title: e.target.value })}
                    maxLength={200}
                  />
                  <input
                    className="input py-1.5 text-sm"
                    list="eod-status"
                    placeholder="Status"
                    aria-label="Status"
                    value={r.status}
                    onChange={(e) => editRow(i, { status: e.target.value })}
                    maxLength={40}
                  />
                  <input className="input py-1.5 text-sm" placeholder="0% → 50%" aria-label="Progress" value={r.progress} onChange={(e) => editRow(i, { progress: e.target.value })} maxLength={40} />
                  <input className="input py-1.5 text-sm" placeholder="Remarks" aria-label="Remarks" value={r.remarks} onChange={(e) => editRow(i, { remarks: e.target.value })} maxLength={200} />
                  <button
                    className="flex items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"
                    onClick={() => edit({ tasks: content.tasks.filter((_, j) => j !== i) })}
                    aria-label="Remove row"
                    title="Remove row"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <datalist id="eod-status">
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {!content.tasks.length && <p className="py-3 text-sm text-muted">No tasks yet.</p>}
            <button className="btn-ghost mt-3 py-1.5 text-xs" onClick={() => edit({ tasks: [...content.tasks, { ...EMPTY_ROW }] })} disabled={content.tasks.length >= 60}>
              + Add row
            </button>
          </section>

          <TextSection title="Blockers / issues" hint="Anything slowing you down. Leave empty if none." value={content.blockers} auto={page.draft.blockers} rows={3} onChange={(v) => edit({ blockers: v })} />
          <TextSection
            title={period === "day" ? "Plan for tomorrow" : "Plan for next week"}
            hint="Starts from your open tickets."
            value={content.plan}
            auto={page.draft.plan}
            rows={4}
            onChange={(v) => edit({ plan: v })}
          />
        </fieldset>
      )}

      {/* Sticky actions (outside the read-only fieldset, so Download still works) */}
      {page && content && busy !== "load" && !all && (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/90 backdrop-blur">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
              <p className="mr-auto text-xs text-muted">
                {readOnly
                  ? `${viewing?.name ?? "Their"} ${kind} · read-only`
                  : dirty
                    ? "Unsaved changes"
                    : page.saved
                      ? `Saved ${timeAgo(page.updatedAt)}`
                      : `Automatic ${kind} — not saved yet`}
              </p>
              {!readOnly && page.saved && (
                <button className="btn-ghost py-1.5 text-sm" onClick={reset} disabled={busy !== null}>
                  {busy === "reset" ? <Spinner /> : null}
                  Reset to automatic
                </button>
              )}
              {!readOnly && (
                <button className="btn-ghost py-1.5 text-sm" onClick={save} disabled={busy !== null || (!dirty && page.saved)}>
                  {busy === "save" ? <Spinner /> : null}
                  Save {kind}
                </button>
              )}
              <DownloadMenu onPick={download} disabled={busy !== null} busy={busy === "pdf"} label="Download" up small />
            </div>
          </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-fg px-4 py-2 text-sm text-bg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function StatusLine({ page, dirty, kind }: { page: EodPage; dirty: boolean; kind: string }) {
  if (dirty) return null;
  return page.saved ? (
    <p className="rounded-xl border border-online/40 bg-online/10 px-4 py-2.5 text-sm">
      ✓ Your {kind} is saved{page.updatedAt ? ` (${timeAgo(page.updatedAt)})` : ""}. The PDF uses this version.
    </p>
  ) : (
    <p className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm">
      ✨ This {kind} was filled in automatically from your activity. Check it, edit anything, then save or download.
    </p>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function TimeField({ label, value, auto, onChange }: { label: string; value: string; auto: string; onChange: (v: string) => void }) {
  return (
    <label className="rounded-lg bg-surface-2 px-3 py-2">
      <span className="block text-[11px] text-muted">{label}</span>
      <input
        type="time"
        className="mt-0.5 w-full bg-transparent font-semibold tabular-nums outline-none"
        value={/^\d{2}:\d{2}$/.test(value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        title={auto ? `Automatic: ${auto}` : "Not recorded — enter it yourself"}
      />
    </label>
  );
}

function TextSection({
  title,
  hint,
  value,
  auto,
  rows,
  onChange,
}: {
  title: string;
  hint: string;
  value: string;
  auto: string;
  rows: number;
  onChange: (v: string) => void;
}) {
  const id = title.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <label htmlFor={id} className="font-semibold">
            {title}
          </label>
          <p className="text-xs text-muted">{hint}</p>
        </div>
        {auto && value !== auto && (
          <button className="text-xs text-muted hover:text-accent" onClick={() => onChange(auto)}>
            Use automatic text
          </button>
        )}
      </div>
      <textarea id={id} className="input mt-3 min-h-20 resize-y text-sm leading-relaxed" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} maxLength={4000} />
    </section>
  );
}

/** "Download ▾" → PDF or CSV. */
function DownloadMenu({
  onPick,
  disabled,
  busy,
  label,
  up = false,
  small = false,
}: {
  onPick: (format: "pdf" | "csv") => void;
  disabled: boolean;
  busy: boolean;
  label: string;
  up?: boolean;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick = (f: "pdf" | "csv") => {
    setOpen(false);
    onPick(f);
  };
  return (
    <div ref={ref} className="relative">
      <button className={`btn-primary ${small ? "py-1.5 text-sm" : ""}`} onClick={() => setOpen((o) => !o)} disabled={disabled} aria-haspopup="menu" aria-expanded={open}>
        {busy ? <Spinner /> : <DownloadIcon />}
        {label}
        <span aria-hidden className="text-xs opacity-80">▾</span>
      </button>
      {open && (
        <div role="menu" className={`card absolute right-0 z-30 w-52 p-1 shadow-lg ${up ? "bottom-full mb-2" : "top-full mt-2"}`}>
          <button role="menuitem" className="flex w-full flex-col items-start rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => pick("pdf")}>
            <span className="font-medium">PDF</span>
            <span className="text-xs text-muted">Ready to upload or print</span>
          </button>
          <button role="menuitem" className="flex w-full flex-col items-start rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => pick("csv")}>
            <span className="font-medium">CSV</span>
            <span className="text-xs text-muted">Opens in Excel / Google Sheets</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Everyone's EOD / EOW and current tasks, a card per person (Team Leads and Managers). */
function Everyone({ pages, period, kind, onOpen }: { pages: EodPage[]; period: Period; kind: string; onOpen: (id: string) => void }) {
  if (!pages.length) return <p className="card p-6 text-center text-sm text-muted">Nobody to show.</p>;
  const sorted = [...pages].sort((a, b) => b.openTasks.length - a.openTasks.length || a.person.name.localeCompare(b.person.name));
  const open = pages.reduce((n, p) => n + p.openTasks.length, 0);
  const notOnline = period === "day" ? pages.filter((p) => !p.attendance[0]?.login).length : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="People" value={String(pages.length)} />
        <Fact label="Current tasks" value={String(open)} />
        <Fact label={`${kind}s saved`} value={`${pages.filter((p) => p.saved).length}/${pages.length}`} />
        {period === "day" ? <Fact label="Not online" value={String(notOnline)} /> : <Fact label="PDFs downloaded" value={`${pages.filter((p) => p.downloadedAt).length}/${pages.length}`} />}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {sorted.map((p) => {
          const a = period === "day" ? p.attendance[0] : null;
          return (
            <article key={p.person._id} className="card flex flex-col p-4">
              <div className="flex items-start gap-3">
                <Avatar name={p.person.name} id={p.person._id} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.person.name}</p>
                  <p className="truncate text-xs text-muted">
                    {p.person.role ?? "No role"}
                    {p.person.teams.length ? ` · ${p.person.teams.join(", ")}` : ""}
                  </p>
                </div>
                <button className="btn-ghost shrink-0 py-1 text-xs" onClick={() => onOpen(p.person._id)}>
                  Open {kind}
                </button>
              </div>

              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                {a ? (
                  a.login ? (
                    <>
                      <span>
                        Login <strong className="text-fg tabular-nums">{a.login}</strong>
                      </span>
                      <span>
                        Logout <strong className="text-fg tabular-nums">{a.logout || "—"}</strong>
                      </span>
                      <span>
                        Online <strong className="text-fg tabular-nums">{dur(a.onlineMinutes)}</strong>
                      </span>
                      {a.lateBy ? <span className="font-semibold text-danger">⏰ {dur(a.lateBy)} late</span> : null}
                    </>
                  ) : (
                    <span className="font-semibold text-danger">Not online</span>
                  )
                ) : (
                  <span>
                    Active <strong className="text-fg">{p.totals.activeDays}/{p.totals.workDays}</strong> days · Online{" "}
                    <strong className="text-fg">{dur(p.totals.onlineMinutes)}</strong>
                  </span>
                )}
                <span className={p.saved ? "text-online" : ""}>{p.saved ? `✓ ${kind} saved` : `${kind} automatic`}</span>
                <span className={p.downloadedAt ? "text-online" : ""}>{p.downloadedAt ? "PDF downloaded" : "PDF not downloaded"}</span>
              </p>

              <h3 className="mt-3 text-[11px] font-semibold tracking-wide text-muted uppercase">Current tasks</h3>
              {p.openTasks.length ? (
                <ul className="mt-1.5 space-y-1.5">
                  {p.openTasks.map((t) => (
                    <li key={t.key} className="flex items-center gap-2 text-sm">
                      <span className="shrink-0 font-mono text-[11px] text-muted">{t.key}</span>
                      <span className="min-w-0 flex-1 truncate" title={t.title}>
                        {t.title}
                      </span>
                      <TaskStatusBadge status={t.status} />
                      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted">{t.progress}%</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted">No open tasks.</p>
              )}

              {p.content.tasks.length > 0 && (
                <>
                  <h3 className="mt-3 text-[11px] font-semibold tracking-wide text-muted uppercase">
                    Worked on {period === "day" ? "today" : "this week"}
                  </h3>
                  <ul className="mt-1.5 space-y-1 text-sm">
                    {p.content.tasks.map((t, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="shrink-0 font-mono text-[11px] text-muted">{t.ticket}</span>
                        <span className="min-w-0 flex-1 truncate" title={t.title}>
                          {t.title}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted">{[t.status, t.progress].filter(Boolean).join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {p.content.summary.trim() && <p className="mt-3 line-clamp-3 text-sm whitespace-pre-line text-muted">{p.content.summary}</p>}
              {p.content.blockers.trim() && <p className="mt-2 text-sm text-danger">⛔ {p.content.blockers}</p>}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
