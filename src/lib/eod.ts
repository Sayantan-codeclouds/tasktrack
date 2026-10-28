import { Types } from "mongoose";
import { connectDB } from "./db";
import { ReportDoc, type IEodContent, type IEodTaskRow } from "./models/ReportDoc";
import { ReportDownload } from "./models/ReportDownload";
import { POSITION_GROUP, TASK_STATUS, TASK_STATUS_LABEL, ticketKey } from "./constants";
import { User } from "./models/User";
import { Team } from "./models/Team";
import { Task } from "./models/Task";
import { adminUserIds } from "./admin";
import { buildPersonReport, type PersonDay, type PersonReport } from "./personReport";
import { formatDay, weekStart } from "./time";
import { buildTeamReport, csvCell, partsText, type Period, type TicketRow } from "./reports";

// A member's EOD / EOW page: an automatic draft from their day(s), which they can edit, save and download.
// The EOW draft is put together from that week's EODs — the saved ones where they exist.

export type EodContent = IEodContent;
export type EodTaskRow = IEodTaskRow;

export interface EodAttendance {
  day: string;
  workDay: boolean;
  login: string;
  logout: string;
  onlineMinutes: number;
  breakMinutes: number;
  lateBy: number | null;
}

export interface EodPage {
  period: Period;
  from: string;
  to: string;
  timeZone: string;
  generatedAt: string;
  person: PersonReport["person"];
  shift: PersonReport["shift"];
  /** Saved by the person (otherwise this is the automatic draft). */
  saved: boolean;
  updatedAt: string | null;
  /** When they last downloaded their own PDF of it (to send to HR). */
  downloadedAt: string | null;
  content: EodContent;
  /** The automatic draft, so the page can offer "reset" per field without another request. */
  draft: EodContent;
  attendance: EodAttendance[];
  totals: PersonReport["totals"];
  /** Their open tickets right now. */
  openTasks: PersonReport["openTasks"];
}

export const EOD_LIMITS = { text: 4000, short: 40, title: 200, rows: 60 } as const;

export function clockTime(iso: string | null, tz: string) {
  return iso ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
}

const progressText = (from: number, to: number) => (from !== to ? `${from}% → ${to}%` : `${to}%`);

/** The automatic EOD for one day of a person's report. */
function dayDraft(d: PersonDay, r: PersonReport): EodContent {
  const tasks: EodTaskRow[] = d.tickets.map((t) => ({
    ticket: t.key,
    title: t.title,
    status: TASK_STATUS_LABEL[t.status],
    progress: progressText(t.from, t.to),
    remarks: [t.created && "New", t.completed && "Completed"].filter(Boolean).join(", "),
  }));
  const notes = d.eodNotes.map((n) => n.text).join("\n\n");
  const auto = [
    ...d.tickets.filter((t) => t.completed).map((t) => `Completed ${t.key} ${t.title}.`),
    ...d.tickets.filter((t) => !t.completed && t.to !== t.from).map((t) => `Worked on ${t.key} ${t.title} (${t.from}% → ${t.to}%).`),
    ...d.tickets.filter((t) => t.created && !t.completed && t.to === t.from).map((t) => `Started ${t.key} ${t.title}.`),
  ].join("\n");
  const blocked = d.tickets.filter((t) => t.blocked && t.status === "blocked").map((t) => `${t.key} ${t.title}`);
  return {
    login: clockTime(d.firstOnline, r.timeZone),
    logout: clockTime(d.lastOffline, r.timeZone),
    summary: notes || auto,
    tasks,
    blockers: blocked.join("\n"),
    plan: r.openTasks.map((t) => `${t.key} ${t.title} (${t.progress}%)`).join("\n"),
  };
}

/** "10% → 40%" + "40% → 70%" → "10% → 70%". */
function mergeProgress(first: string, last: string) {
  const a = first.match(/^(\d+)%/);
  const b = last.match(/(\d+)%$/);
  return a && b ? progressText(Number(a[1]), Number(b[1])) : last || first;
}

/** The automatic EOW: the week's EODs rolled up. */
function weekDraft(days: { day: string; content: EodContent }[], r: PersonReport): EodContent {
  const label = (d: string) => formatDay(d, { weekday: "short", day: "numeric", month: "short" });
  const rows = new Map<string, EodTaskRow>();
  for (const { content } of days) {
    for (const t of content.tasks) {
      const k = (t.ticket || t.title).trim().toLowerCase();
      if (!k) continue;
      const prev = rows.get(k);
      if (!prev) {
        rows.set(k, { ...t });
        continue;
      }
      const remarks = [...new Set([...prev.remarks.split(", "), ...t.remarks.split(", ")].filter(Boolean))].join(", ");
      rows.set(k, { ...t, progress: mergeProgress(prev.progress, t.progress), remarks });
    }
  }
  const lines = (pick: (c: EodContent) => string) =>
    [...new Set(days.flatMap(({ content }) => pick(content).split("\n").map((l) => l.trim()).filter(Boolean)))].join("\n");
  return {
    login: "",
    logout: "",
    summary: days
      .filter(({ content }) => content.summary.trim())
      .map(({ day, content }) => `${label(day)}: ${content.summary.trim()}`)
      .join("\n\n"),
    tasks: [...rows.values()],
    blockers: lines((c) => c.blockers),
    plan: r.openTasks.map((t) => `${t.key} ${t.title} (${t.progress}%)`).join("\n"),
  };
}

const contentOf = (doc: Partial<EodContent>): EodContent => ({
  login: doc.login ?? "",
  logout: doc.logout ?? "",
  summary: doc.summary ?? "",
  tasks: (doc.tasks ?? []).map((t) => ({ ticket: t.ticket ?? "", title: t.title ?? "", status: t.status ?? "", progress: t.progress ?? "", remarks: t.remarks ?? "" })),
  blockers: doc.blockers ?? "",
  plan: doc.plan ?? "",
});

/**
 * A Manager's automatic EOD / EOW: they oversee rather than work tickets, so it's their teams' work —
 * every open ticket and everything done, and by whom. Null for everyone else.
 */
async function overseerDraft(userId: string, period: Period, date: string): Promise<EodContent | null> {
  const me = await User.findById(userId).select("position").lean();
  if (!me?.position || POSITION_GROUP[me.position] !== "management") return null;
  const uid = new Types.ObjectId(userId);
  // The teams they manage or are in; a Manager with no team oversees them all.
  let teams = await Team.find({ $or: [{ manager: uid }, { "members.user": uid }] }).select("_id name").sort({ name: 1 }).lean();
  if (!teams.length) teams = await Team.find().select("_id name").sort({ name: 1 }).lean();
  const hide = await adminUserIds();

  const tasks: EodTaskRow[] = [];
  const summary: string[] = [];
  const blockers: string[] = [];
  const plan: string[] = [];
  for (const t of teams) {
    const r = await buildTeamReport(String(t._id), period, date, { hideUserIds: hide });
    if (!r) continue;
    const names = (x: TicketRow) =>
      [...new Set([x.assignee?.name, ...x.collaborators.map((c) => c.name), ...x.contributors.map((c) => c.name)].filter(Boolean))].join(", ");
    const prefix = teams.length > 1 ? `[${t.name}] ` : "";
    const shown = new Set<string>();

    // Tickets that moved this day / week: done first, then the rest.
    for (const x of r.tickets) {
      x.key.split(" + ").forEach((k) => shown.add(k));
      tasks.push({
        ticket: x.key,
        title: prefix + x.title,
        status: x.completed ? "Done" : TASK_STATUS_LABEL[x.status],
        progress: progressText(x.start, x.end),
        remarks: x.parts ? partsText(x) : [x.completed ? `Done by ${names(x)}` : names(x), x.isNew && "new"].filter(Boolean).join(" · "),
      });
    }
    // Everything else still open on the board.
    const open = await Task.find({ team: t._id, status: { $ne: "done" } })
      .populate<{ assignee: { _id: Types.ObjectId; name: string } | null }>("assignee", "name")
      .populate<{ collaborators: { _id: Types.ObjectId; name: string }[] }>("collaborators", "name")
      .sort({ number: 1 })
      .lean();
    for (const o of open) {
      if (o.assignee && hide.includes(String(o.assignee._id))) continue;
      const key = ticketKey(o.number);
      if (shown.has(key)) continue;
      const who = [o.assignee, ...(o.collaborators ?? [])].filter((p) => p && !hide.includes(String(p._id))).map((p) => p!.name);
      tasks.push({ ticket: key, title: prefix + o.title, status: TASK_STATUS_LABEL[o.status], progress: `${o.progress}%`, remarks: who.join(", ") || "Unassigned" });
    }

    const done = r.tickets.filter((x) => x.completed);
    const counts = TASK_STATUS.filter((s) => s !== "done")
      .map((s) => [s, open.filter((o) => o.status === s).length] as const)
      .map(([s, n]) => `${n} ${TASK_STATUS_LABEL[s].toLowerCase()}`);
    summary.push(
      `${t.name}: ${done.length} completed, ${r.totals.created} new, ${counts.join(", ")}.` +
        (done.length ? `\nCompleted: ${done.map((x) => `${x.key} ${x.title} (${names(x)})`).join("; ")}.` : "") +
        (period === "day" && r.missingEod.length ? `\nNo EOD yet: ${r.missingEod.join(", ")}.` : ""),
    );
    for (const x of r.tickets.filter((x) => x.status === "blocked")) blockers.push(`${prefix}${x.key} ${x.title} — ${names(x)}`);
    for (const o of open.filter((o) => o.status === "blocked" && !shown.has(ticketKey(o.number)))) blockers.push(`${prefix}${ticketKey(o.number)} ${o.title} — ${o.assignee?.name ?? "unassigned"}`);
    const due = open.filter((o) => o.dueDate).sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime()).slice(0, 5);
    for (const o of due) plan.push(`Follow up ${ticketKey(o.number)} ${o.title} (${o.assignee?.name ?? "unassigned"}, due ${o.dueDate!.toISOString().slice(0, 10)})`);
  }
  if (!plan.length) plan.push("Review open tickets with the team.");
  return { login: "", logout: "", summary: summary.join("\n\n"), tasks: tasks.slice(0, EOD_LIMITS.rows), blockers: blockers.join("\n"), plan: plan.join("\n") };
}

export async function buildEodPage(userId: string, period: Period, date: string): Promise<EodPage | null> {
  await connectDB();
  const r = await buildPersonReport(userId, period, date);
  if (!r) return null;
  const user = new Types.ObjectId(userId);
  const key = period === "day" ? r.from : weekStart(r.from);

  // Each day's EOD: saved version, else the automatic one.
  const savedDays = new Map(
    (await ReportDoc.find({ user, period: "day", key: { $in: r.days.map((d) => d.day) } }).lean()).map((d) => [d.key, d]),
  );
  const days = r.days.map((d) => {
    const saved = savedDays.get(d.day);
    return { day: d.day, person: d, content: saved ? contentOf(saved) : dayDraft(d, r), saved: Boolean(saved) };
  });

  const own =
    period === "day"
      ? dayDraft(r.days[0], r)
      : weekDraft(
          days.filter((d) => d.saved || d.person.tickets.length || d.person.eodNotes.length),
          r,
        );
  // Managers: their teams' work instead (keeping their own login / logout).
  const team = await overseerDraft(userId, period, r.from);
  const draft = team ? { ...team, login: own.login, logout: own.logout } : own;
  const [saved, download] = await Promise.all([ReportDoc.findOne({ user, period, key }).lean(), ReportDownload.findOne({ user, period, key }).lean()]);

  return {
    period,
    from: r.from,
    to: r.to,
    timeZone: r.timeZone,
    generatedAt: r.generatedAt,
    person: r.person,
    shift: r.shift,
    saved: Boolean(saved),
    updatedAt: saved ? saved.updatedAt.toISOString() : null,
    downloadedAt: download ? download.at.toISOString() : null,
    content: saved ? contentOf(saved) : draft,
    draft,
    attendance: days.map(({ day, person, content }) => ({
      day,
      workDay: person.workDay,
      login: content.login || clockTime(person.firstOnline, r.timeZone),
      logout: content.logout || clockTime(person.lastOffline, r.timeZone),
      onlineMinutes: person.onlineMinutes,
      breakMinutes: person.breakMinutes,
      lateBy: person.lateBy,
    })),
    totals: r.totals,
    openTasks: r.openTasks,
  };
}

export async function saveEod(userId: string, period: Period, key: string, content: EodContent) {
  await connectDB();
  await ReportDoc.updateOne(
    { user: new Types.ObjectId(userId), period, key },
    { $set: content },
    { upsert: true },
  );
}

/** Remember that someone downloaded their own EOD / EOW PDF. */
export async function markEodDownloaded(userId: string, period: Period, key: string, via: "web" | "telegram") {
  await connectDB();
  await ReportDownload.updateOne({ user: new Types.ObjectId(userId), period, key }, { $set: { at: new Date(), via } }, { upsert: true });
}

export async function resetEod(userId: string, period: Period, key: string) {
  await connectDB();
  await ReportDoc.deleteOne({ user: new Types.ObjectId(userId), period, key });
}

/**
 * EODs as one CSV: a row per task worked on, then everyone's current open tickets.
 * `attendance` adds online time (for Team Leads and Managers — not the HR copy). Login / logout times never go in a download.
 */
export function eodCsv(pages: EodPage[], opts: { attendance: boolean }) {
  const att = (p: EodPage) => {
    const a = p.period === "day" ? p.attendance[0] : null;
    return [dur(a ? a.onlineMinutes : p.totals.onlineMinutes)];
  };
  const kind = pages[0]?.period === "week" ? "EOW" : "EOD";
  const rows: unknown[][] = [];
  rows.push([kind, pages[0] ? (pages[0].period === "day" ? pages[0].from : `${pages[0].from} to ${pages[0].to}`) : ""]);
  rows.push([]);
  rows.push(["Name", "Role", "Team", ...(opts.attendance ? ["Online"] : []), "Ticket", "Task", "Status", "Progress", "Remarks", "Summary", "Blockers", "Plan"]);
  for (const p of pages) {
    const who = [p.person.name, p.person.role ?? "", p.person.teams.join(", "), ...(opts.attendance ? att(p) : [])];
    const tasks = p.content.tasks.length ? p.content.tasks : [null];
    tasks.forEach((t, i) =>
      rows.push([
        ...who,
        t?.ticket ?? "",
        t?.title ?? "",
        t?.status ?? "",
        t?.progress ?? "",
        t?.remarks ?? "",
        // The written parts once per person.
        ...(i === 0 ? [p.content.summary, p.content.blockers, p.content.plan] : ["", "", ""]),
      ]),
    );
  }
  rows.push([], ["CURRENT TASKS (open right now)"]);
  rows.push(["Name", "Ticket", "Task", "Status", "Progress", "Due"]);
  for (const p of pages) {
    for (const t of p.openTasks) rows.push([p.person.name, t.key, t.title, TASK_STATUS_LABEL[t.status], `${t.progress}%`, t.dueDate ? t.dueDate.slice(0, 10) : ""]);
  }
  // BOM so Excel opens UTF-8 correctly.
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${min}m`);

/** e.g. "eod-sayantan-das-2026-10-27.pdf" */
export function eodFileName(p: EodPage) {
  const slug = p.person.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "me";
  return `${p.period === "day" ? "eod" : "eow"}-${slug}-${p.from}.pdf`;
}
