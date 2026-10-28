import { Types } from "mongoose";
import { connectDB } from "./db";
import { User } from "./models/User";
import { Team } from "./models/Team";
import { Task } from "./models/Task";
import { ActivityLog } from "./models/ActivityLog";
import { POSITION_LABEL, TASK_STATUS, ticketKey, type Position, type TaskStatus } from "./constants";
import { addDays, appTimeZone, dayKey, startOfDay, weekdayOf, weekStart } from "./time";
import { presenceChangeAt, reportWorkDays, type Period } from "./reports";

// One person's EOD (a day) or EOW (a week — simply that week's EODs, plus totals),
// built from what they did in Telegram and on the site. This is what members send to HR.

export interface PersonTicket {
  key: string;
  title: string;
  /** Progress before their first change in the period, and after their last. */
  from: number;
  to: number;
  status: TaskStatus;
  created: boolean;
  completed: boolean;
  blocked: boolean;
}

export interface PersonDay {
  day: string;
  workDay: boolean;
  firstOnline: string | null;
  /** Last time they went offline that day. */
  lastOffline: string | null;
  lastActive: string | null;
  onlineMinutes: number;
  breakMinutes: number;
  /** Minutes after shift start (only when late). */
  lateBy: number | null;
  tickets: PersonTicket[];
  eodNotes: { at: string; text: string }[];
  timeline: { at: string; text: string }[];
}

export interface PersonReport {
  person: { _id: string; name: string; email: string; role: string | null; teams: string[] };
  period: Period;
  from: string;
  to: string;
  timeZone: string;
  generatedAt: string;
  shift: { start: string; end: string } | null;
  days: PersonDay[];
  totals: {
    onlineMinutes: number;
    breakMinutes: number;
    completed: number;
    workedOn: number;
    created: number;
    blocked: number;
    activeDays: number;
    workDays: number;
    lateDays: number;
    eodNotes: number;
  };
  /** Their open tickets right now — what carries over. */
  openTasks: { key: string; title: string; status: TaskStatus; progress: number; dueDate: string | null }[];
}

const TICKET_TYPES = new Set(["task_created", "task_progress", "task_status", "task_completed"]);
const STATUS_TEXT: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" };
const PRESENCE_TEXT: Record<string, string> = { online: "Online", break: "On break", offline: "Offline" };
const LATE_GRACE_MIN = 10;
type Meta = Record<string, unknown> | null | undefined;
const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const isStatus = (v: unknown): v is TaskStatus => typeof v === "string" && (TASK_STATUS as readonly string[]).includes(v);

export async function buildPersonReport(userId: string, period: Period, date: string): Promise<PersonReport | null> {
  await connectDB();
  const user = await User.findById(userId).select("name email position").lean();
  if (!user) return null;
  const id = new Types.ObjectId(userId);
  const tz = appTimeZone();
  const from = period === "day" ? date : weekStart(date);
  const dayList = period === "day" ? [date] : Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const to = dayList[dayList.length - 1];
  const start = startOfDay(from, tz);
  const end = startOfDay(addDays(to, 1), tz);
  const clipEnd = new Date(Math.min(end.getTime(), Date.now()));
  const workDays = reportWorkDays();

  const teams = await Team.find({ $or: [{ "members.user": id }, { lead: id }, { manager: id }] })
    .select("name shiftStart shiftEnd")
    .sort({ name: 1 })
    .lean();
  const shiftTeam = teams.find((t) => t.shiftStart && t.shiftEnd);
  const shift = shiftTeam ? { start: shiftTeam.shiftStart!, end: shiftTeam.shiftEnd! } : null;

  const days = new Map<string, PersonDay>(
    dayList.map((d) => [
      d,
      { day: d, workDay: workDays.includes(weekdayOf(d)), firstOnline: null, lastOffline: null, lastActive: null, onlineMinutes: 0, breakMinutes: 0, lateBy: null, tickets: [], eodNotes: [], timeline: [] },
    ]),
  );
  const dayOf = (at: Date) => days.get(dayKey(at, tz));

  const logs = await ActivityLog.find({ createdAt: { $gte: start, $lt: end }, $or: [{ actor: id }, { user: id }] })
    .sort({ createdAt: 1 })
    .lean();

  // ---------- tickets, day by day (only their own actions; anonymous admin edits don't count) ----------
  const taskIds = [...new Set(logs.filter((l) => l.task && TICKET_TYPES.has(l.type)).map((l) => String(l.task)))];
  const tasks = new Map((await Task.find({ _id: { $in: taskIds } }).select("number title status progress").lean()).map((t) => [String(t._id), t]));
  const perDay = new Map<string, Map<string, PersonTicket>>();

  for (const l of logs) {
    const meta = l.meta as Meta;
    const d = dayOf(l.createdAt);
    if (!d) continue;
    const at = l.createdAt.toISOString();

    if (l.type === "eod_note" && String(l.user) === userId) {
      const text = typeof meta?.text === "string" ? meta.text : l.message;
      d.eodNotes.push({ at, text });
      d.timeline.push({ at, text: `EOD note: ${text}` });
      continue;
    }
    if (!l.task || !TICKET_TYPES.has(l.type)) continue;
    const actor = meta?.byAdmin ? "" : String(l.actor ?? l.user ?? "");
    if (actor !== userId) continue;
    const task = tasks.get(String(l.task));
    if (!task) continue; // deleted since

    const key = ticketKey(task.number);
    const tickets = perDay.get(d.day) ?? new Map<string, PersonTicket>();
    perDay.set(d.day, tickets);
    let t = tickets.get(String(l.task));
    if (!t) {
      // Progress before their first change that day (status-only changes don't say, so use today's value).
      const before =
        l.type === "task_created"
          ? 0
          : l.type === "task_progress"
            ? num(meta?.from)
            : l.type === "task_completed"
              ? num((meta?.from as Meta)?.progress)
              : undefined;
      const startAt = before ?? task.progress;
      t = { key, title: task.title, from: startAt, to: startAt, status: task.status, created: false, completed: false, blocked: false };
      tickets.set(String(l.task), t);
    }

    let line = "";
    if (l.type === "task_created") {
      t.created = true;
      t.to = num(meta?.progress) ?? 0;
      t.status = isStatus(meta?.status) ? meta.status : t.to > 0 ? "in_progress" : "todo";
      line = "created";
    } else if (l.type === "task_progress") {
      t.to = num(meta?.to) ?? t.to;
      line = `${num(meta?.from) ?? "?"}% → ${num(meta?.to) ?? "?"}%`;
    } else if (l.type === "task_completed") {
      t.to = 100;
      t.status = "done";
      t.completed = true;
      line = "completed";
    } else if (l.type === "task_status") {
      if (!isStatus(meta?.to)) continue; // reassignments / priority changes
      t.status = meta.to;
      if (meta.to === "blocked") t.blocked = true;
      line = `→ ${STATUS_TEXT[meta.to]}`;
    }
    d.timeline.push({ at, text: `${key} ${task.title}: ${line}` });
    if (!d.lastActive || d.lastActive < at) d.lastActive = at;
  }
  for (const [day, tickets] of perDay) days.get(day)!.tickets = [...tickets.values()];

  // ---------- online / break time ----------
  if (clipEnd > start) {
    const [baseline, changes] = await Promise.all([
      ActivityLog.findOne({ type: "status_change", user: id, createdAt: { $lt: start } }).sort({ createdAt: -1 }).select("meta").lean(),
      ActivityLog.find({ type: "status_change", user: id, createdAt: { $gte: start, $lt: clipEnd } }).sort({ createdAt: 1 }).select("createdAt meta").lean(),
    ]);
    let state = String((baseline?.meta as Meta)?.to ?? "offline");
    let since = start.getTime();
    const add = (until: number) => {
      if (until <= since || (state !== "online" && state !== "break")) return;
      for (const d of days.values()) {
        const ds = startOfDay(d.day, tz).getTime();
        const de = startOfDay(addDays(d.day, 1), tz).getTime();
        const ms = Math.min(until, de) - Math.max(since, ds);
        if (ms <= 0) continue;
        if (state === "online") d.onlineMinutes += ms / 60000;
        else d.breakMinutes += ms / 60000;
      }
    };
    for (const c of changes) {
      const next = String((c.meta as Meta)?.to ?? "offline");
      const note = (c.meta as Meta)?.note;
      const at = new Date(Math.max(presenceChangeAt(c), since));
      add(at.getTime());
      state = next;
      since = at.getTime();
      const d = dayOf(at);
      if (!d) continue;
      if (next === "online" && !d.firstOnline) d.firstOnline = at.toISOString();
      if (next === "offline") d.lastOffline = at.toISOString();
      d.timeline.push({ at: at.toISOString(), text: `${PRESENCE_TEXT[next] ?? next}${typeof note === "string" && note ? ` — ${note}` : ""}` });
    }
    add(clipEnd.getTime());
  }

  // ---------- late against the shift ----------
  for (const d of days.values()) {
    d.onlineMinutes = Math.round(d.onlineMinutes);
    d.breakMinutes = Math.round(d.breakMinutes);
    d.timeline.sort((a, b) => a.at.localeCompare(b.at));
    if (shift && d.firstOnline) {
      const [h, m] = shift.start.split(":").map(Number);
      const lateBy = Math.round((new Date(d.firstOnline).getTime() - startOfDay(d.day, tz).getTime() - (h * 60 + m) * 60000) / 60000);
      if (lateBy > LATE_GRACE_MIN) d.lateBy = lateBy;
    }
  }

  const open = await Task.find({ $or: [{ assignee: id }, { collaborators: id }], status: { $ne: "done" } })
    .select("number title status progress dueDate")
    .sort({ status: 1, updatedAt: -1 })
    .limit(30)
    .lean();

  // In an EOW, a ticket counts once however many days it was touched.
  const all = [...days.values()];
  const distinct = (pick: (t: PersonTicket) => boolean) => new Set(all.flatMap((d) => d.tickets.filter(pick).map((t) => t.key))).size;
  const active = (d: PersonDay) => d.onlineMinutes > 0 || d.tickets.length > 0 || d.eodNotes.length > 0;

  return {
    person: {
      _id: userId,
      name: user.name,
      email: user.email,
      role: user.position ? POSITION_LABEL[user.position as Position] : null,
      teams: teams.map((t) => t.name),
    },
    period,
    from,
    to,
    timeZone: tz,
    generatedAt: new Date().toISOString(),
    shift,
    days: all,
    totals: {
      onlineMinutes: all.reduce((n, d) => n + d.onlineMinutes, 0),
      breakMinutes: all.reduce((n, d) => n + d.breakMinutes, 0),
      completed: distinct((t) => t.completed),
      workedOn: distinct(() => true),
      created: distinct((t) => t.created),
      blocked: distinct((t) => t.blocked && t.status === "blocked"),
      activeDays: all.filter(active).length,
      workDays: period === "day" ? 1 : all.filter((d) => d.workDay).length,
      lateDays: all.filter((d) => d.lateBy).length,
      eodNotes: all.reduce((n, d) => n + d.eodNotes.length, 0),
    },
    openTasks: open.map((t) => ({
      key: ticketKey(t.number),
      title: t.title,
      status: t.status,
      progress: t.progress,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    })),
  };
}

