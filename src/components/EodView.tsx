"use client";

import { useCallback, useEffect, useState } from "react";
import { api, readPref, timeAgo, writePref } from "@/lib/client";
import type { EodContent, EodPage, EodTaskRow } from "@/lib/eod";
import { Spinner } from "./ui";

type Period = "day" | "week";

const PERIOD_PREF = "tt.eod.period";

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
const fmt = (s: string, o: Intl.DateTimeFormatOptions) => parse(s).toLocaleDateString(undefined, o);
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
    api<{ page: EodPage }>(`/api/eod?period=${period}&date=${date}`)
      .then((r) => !cancelled && show(r.page))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
    };
  }, [period, date, show]);

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
  const go = (next: { period?: Period; date?: string }) => {
    if (!leave()) return;
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

  async function downloadPdf() {
    // The PDF is made from what's saved, so save first.
    if (dirty && !(await save())) return;
    setBusy("pdf");
    window.location.href = `/api/eod/pdf?period=${period}&date=${date}`;
    setTimeout(() => setBusy(null), 1500);
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

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">EOD / EOW</h1>
          <p className="mt-0.5 text-sm text-muted">Your end-of-day and end-of-week report. Filled in automatically — edit it, save, and download the PDF for HR.</p>
        </div>
        <button className="btn-primary" onClick={downloadPdf} disabled={!content || busy !== null}>
          {busy === "pdf" ? <Spinner /> : <DownloadIcon />}
          Download PDF
        </button>
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
      ) : (
        <>
          <StatusLine page={page} dirty={dirty} kind={kind} />

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
                <h2 className="font-semibold">{period === "day" ? "Tasks worked on" : "Tasks this week"}</h2>
                <p className="text-xs text-muted">From your tickets. Add anything that wasn&apos;t a ticket (meetings, reviews, calls).</p>
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

          {/* Sticky actions */}
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/90 backdrop-blur">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
              <p className="mr-auto text-xs text-muted">
                {dirty ? "Unsaved changes" : page.saved ? `Saved ${timeAgo(page.updatedAt)}` : `Automatic ${kind} — not saved yet`}
              </p>
              {page.saved && (
                <button className="btn-ghost py-1.5 text-sm" onClick={reset} disabled={busy !== null}>
                  {busy === "reset" ? <Spinner /> : null}
                  Reset to automatic
                </button>
              )}
              <button className="btn-ghost py-1.5 text-sm" onClick={save} disabled={busy !== null || (!dirty && page.saved)}>
                {busy === "save" ? <Spinner /> : null}
                Save {kind}
              </button>
              <button className="btn-primary py-1.5 text-sm" onClick={downloadPdf} disabled={busy !== null}>
                {busy === "pdf" ? <Spinner /> : <DownloadIcon />}
                Download PDF
              </button>
            </div>
          </div>
        </>
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

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
