import { Types } from "mongoose";
import { connectDB } from "./db";
import { Team } from "./models/Team";
import { Task } from "./models/Task";
import { ActivityLog, type IActivityLog } from "./models/ActivityLog";
import { User } from "./models/User";
import { ReportDoc } from "./models/ReportDoc";
import { POSITION_GROUP, TASK_STATUS, ticketKey, type Position, type Priority, type TaskStatus } from "./constants";
import { addDays, appTimeZone, dayKey, formatDay, startOfDay, weekdayOf, weekStart } from "./time";

export type Period = "day" | "week";

/** Days that get an EOD (0 = Sunday … 6 = Saturday). Default Mon–Fri. */
export const reportWorkDays = () => (process.env.REPORT_WORK_DAYS ?? "1,2,3,4,5").split(",").map(Number);

export interface TicketRef {
  _id: string;
  key: string;
  title: string;
}

export interface TicketDay {
  /** Progress at the end of this day. */
  progress: number;
  status: TaskStatus;
  changed: boolean;
  /** Ids of the people who touched the ticket that day. */
  by: string[];
  events: number;
  /** The ticket didn't exist yet on this day. */
  notYet?: boolean;
}

export interface TicketRow extends TicketRef {
  priority: Priority;
  status: TaskStatus;
  assignee: { _id: string; name: string } | null;
  collaborators: { _id: string; name: string }[];
  start: number;
  end: number;
  isNew: boolean;
  completed: boolean;
  blocked: boolean;
  contributors: { _id: string; name: string; events: number }[];
  days: Record<string, TicketDay>;
}

export interface MemberRow {
  _id: string;
  name: string;
  position: Position | null;
  inTeam: boolean;
  completed: TicketRef[];
  progressed: (TicketRef & { from: number; to: number })[];
  created: TicketRef[];
  blocked: TicketRef[];
  events: number;
  activeDays: string[];
  onlineMinutes: number;
  breakMinutes: number;
  eodNotes: { at: string; text: string }[];
  /** Days they came online after the shift start (+ grace). */
  lateDays: number;
  /** Everything they did, day by day. */
  days: Record<string, MemberDay>;
}

export interface MemberEvent {
  at: string;
  kind: "created" | "progress" | "completed" | "status" | "presence" | "eod";
  ticket?: TicketRef;
  text: string;
}

export interface MemberDay {
  onlineMinutes: number;
  breakMinutes: number;
  /** First time they went online that day. */
  firstOnline: string | null;
  lastActive: string | null;
  /** Minutes after the team's shift start (only when late). */
  lateBy: number | null;
  events: MemberEvent[];
}

export interface TeamReport {
  team: {
    _id: string;
    name: string;
    color: string;
    telegramLinked: boolean;
    shiftStart: string | null;
    shiftEnd: string | null;
    lead: string | null;
    manager: string | null;
  };
  period: Period;
  from: string;
  to: string;
  days: string[];
  /** How many of `days` are working days — "active 4/5 days" on an EOW. */
  workDays: number;
  timeZone: string;
  generatedAt: string;
  totals: { completed: number; progressUpdates: number; created: number; blocked: number; activePeople: number; eodNotes: number };
  members: MemberRow[];
  tickets: TicketRow[];
  /** Day reports: team members (not managers) who haven't posted an EOD note. */
  missingEod: string[];
}

const TICKET_TYPES = new Set(["task_created", "task_progress", "task_status", "task_completed"]);
/** Coming online up to this many minutes after shift start isn't counted as late. */
const LATE_GRACE_MIN = 10;
const PRESENCE_TEXT: Record<string, string> = { online: "Online", break: "On break", offline: "Offline" };
const STATUS_TEXT: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" };
const isStatus = (v: unknown): v is TaskStatus => typeof v === "string" && (TASK_STATUS as readonly string[]).includes(v);
type Meta = Record<string, unknown> | null | undefined;
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

export async function buildTeamReport(
  teamId: string,
  period: Period,
  date: string,
  /** People to leave out completely (the admin, for everyone but the admin). */
  opts: { hideUserIds?: string[] } = {},
): Promise<TeamReport | null> {
  const hide = new Set(opts.hideUserIds ?? []);
  await connectDB();
  const tz = appTimeZone();
  const from = period === "day" ? date : weekStart(date);
  const days = period === "day" ? [date] : Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const to = days[days.length - 1];
  const start = startOfDay(from, tz);
  const end = startOfDay(addDays(to, 1), tz);
  const clipEnd = new Date(Math.min(end.getTime(), Date.now()));

  const team = await Team.findById(teamId)
    .populate<{ members: { user: { _id: Types.ObjectId; name: string; position: Position | null } | null }[] }>("members.user", "name position")
    .populate<{ lead: { _id: Types.ObjectId; name: string } | null }>("lead", "name")
    .populate<{ manager: { _id: Types.ObjectId; name: string } | null }>("manager", "name")
    .lean();
  if (!team) return null;
  const dayBounds = days.map((d) => ({ day: d, start: startOfDay(d, tz).getTime(), end: startOfDay(addDays(d, 1), tz).getTime() }));

  const teamTaskIds = await Task.find({ team: team._id }).distinct("_id");
  const memberIds = team.members.flatMap((m) => (m.user ? [m.user._id] : []));
  const logs = (
    await ActivityLog.find({
      createdAt: { $gte: start, $lt: end },
      $or: [
        { team: team._id },
        { task: { $in: teamTaskIds } },
        // EOD notes a member sent the bot privately (not tied to any one team).
        { type: "eod_note", team: null, user: { $in: memberIds } },
      ],
    })
      .sort({ createdAt: 1 })
      .lean()
  ).filter((l) => !hide.has(String(l.actor ?? "")) && !hide.has(String(l.user ?? "")));

  // ---------- people ----------
  const people = new Map<string, MemberRow>();
  const person = (id: string, name = "Unknown", position: Position | null = null, inTeam = false) => {
    let p = people.get(id);
    if (!p) {
      p = { _id: id, name, position, inTeam, completed: [], progressed: [], created: [], blocked: [], events: 0, activeDays: [], onlineMinutes: 0, breakMinutes: 0, eodNotes: [], lateDays: 0, days: {} };
      people.set(id, p);
    }
    return p;
  };
  const dayOf = (p: MemberRow, day: string) =>
    (p.days[day] ??= { onlineMinutes: 0, breakMinutes: 0, firstOnline: null, lastActive: null, lateBy: null, events: [] });
  const note = (id: string, at: Date, e: Omit<MemberEvent, "at">) => {
    if (!id) return;
    const d = dayOf(person(id), dayKey(at, tz));
    d.events.push({ ...e, at: at.toISOString() });
    if (e.kind !== "presence" && (!d.lastActive || d.lastActive < at.toISOString())) d.lastActive = at.toISOString();
  };
  for (const m of team.members) {
    if (m.user && !hide.has(String(m.user._id))) person(String(m.user._id), m.user.name, m.user.position ?? null, true);
  }

  const ticketLogs = logs.filter((l) => l.task && TICKET_TYPES.has(l.type));
  const actorIds = [...new Set(logs.map((l) => String(l.actor ?? l.user ?? "")).filter(Boolean))].filter((id) => !people.has(id));
  if (actorIds.length) {
    const extra = await User.find({ _id: { $in: actorIds } }).select("name position").lean();
    for (const u of extra) person(String(u._id), u.name, u.position ?? null, false);
  }

  // ---------- tickets ----------
  const byTask = new Map<string, IActivityLog[]>();
  for (const l of ticketLogs) {
    const id = String(l.task);
    if (!byTask.has(id)) byTask.set(id, []);
    byTask.get(id)!.push(l);
  }
  const tasks = (
    await Task.find({ _id: { $in: [...byTask.keys()] } })
      .populate<{ assignee: { _id: Types.ObjectId; name: string } | null }>("assignee", "name")
      .populate<{ collaborators: { _id: Types.ObjectId; name: string }[] }>("collaborators", "name")
      .lean()
  )
    .filter((t) => !(t.assignee && hide.has(String(t.assignee._id))))
    .map((t) => ({ ...t, collaborators: (t.collaborators ?? []).filter((c) => c && !hide.has(String(c._id))) }));

  const tickets: TicketRow[] = [];
  let progressUpdates = 0;
  for (const t of tasks) {
    const events = byTask.get(String(t._id)) ?? [];
    const ref: TicketRef = { _id: String(t._id), key: ticketKey(t.number), title: t.title };
    let start: number | undefined;
    let cur: number | undefined;
    let status: TaskStatus | undefined;
    let startStatus: TaskStatus | undefined;
    let createdDay: string | undefined;
    let isNew = false;
    let completed = false;
    let blocked = false;
    const perDay = new Map<string, { progress?: number; status?: TaskStatus; by: Set<string>; events: number }>();
    const contributors = new Map<string, number>();

    for (const e of events) {
      const meta = e.meta as Meta;
      // Admin changes are anonymous — don't credit them to anyone.
      const actor = (e.meta as Meta)?.byAdmin ? "" : String(e.actor ?? e.user ?? "");
      const day = dayKey(e.createdAt, tz);
      if (e.type === "task_created") {
        isNew = true;
        createdDay = day;
        cur = num(meta?.progress) ?? 0;
        start ??= cur;
        status = isStatus(meta?.status) ? meta.status : cur > 0 ? "in_progress" : "todo";
        if (actor) person(actor).created.push(ref);
        note(actor, e.createdAt, { kind: "created", ticket: ref, text: "created" });
      } else if (e.type === "task_progress") {
        const fromV = num(meta?.from);
        const toV = num(meta?.to);
        start ??= cur ?? fromV;
        if (toV !== undefined) cur = toV;
        progressUpdates++;
        note(actor, e.createdAt, { kind: "progress", ticket: ref, text: `${fromV ?? "?"}% → ${toV ?? "?"}%` });
        if (actor && fromV !== undefined && toV !== undefined) {
          const p = person(actor);
          const existing = p.progressed.find((x) => x._id === ref._id);
          if (existing) existing.to = toV;
          else p.progressed.push({ ...ref, from: fromV, to: toV });
        }
      } else if (e.type === "task_completed") {
        const before = meta?.from as Meta;
        start ??= cur ?? num(before?.progress);
        if (status === undefined && isStatus(before?.status)) startStatus ??= before.status;
        cur = 100;
        status = "done";
        completed = true;
        if (actor && !person(actor).completed.some((x) => x._id === ref._id)) person(actor).completed.push(ref);
        note(actor, e.createdAt, { kind: "completed", ticket: ref, text: "completed ✓" });
      } else if (e.type === "task_status") {
        // Also used for reassignments / priority / collaborator changes — only real status moves change status.
        if (isStatus(meta?.to)) {
          if (status === undefined && isStatus(meta?.from)) startStatus ??= meta.from;
          status = meta.to;
          if (status === "blocked") {
            blocked = true;
            if (actor) person(actor).blocked.push(ref);
          }
          note(actor, e.createdAt, { kind: "status", ticket: ref, text: `→ ${STATUS_TEXT[meta.to]}` });
        } else {
          // e.g. "TT-3 “X” now shared with Dia" — keep the part after the ticket title.
          note(actor, e.createdAt, { kind: "status", ticket: ref, text: e.message.replace(/^.*?”\s*/, "") });
        }
      }
      if (actor) {
        contributors.set(actor, (contributors.get(actor) ?? 0) + 1);
        const p = person(actor);
        p.events++;
        if (!p.activeDays.includes(day)) p.activeDays.push(day);
      }
      const d = perDay.get(day) ?? { by: new Set<string>(), events: 0 };
      d.progress = cur;
      d.status = status;
      if (actor) d.by.add(actor);
      d.events++;
      perDay.set(day, d);
    }

    const startV = start ?? cur ?? t.progress;
    // Status before the first change in the period (for days before anything happened).
    const firstStatus: TaskStatus = isNew ? "todo" : (startStatus ?? (startV > 0 ? "in_progress" : "todo"));
    let carryP = startV;
    let carryS: TaskStatus = firstStatus;
    const dayCells: Record<string, TicketDay> = {};
    for (const d of days) {
      const cell = perDay.get(d);
      if (cell) {
        carryP = cell.progress ?? carryP;
        carryS = cell.status ?? carryS;
      }
      dayCells[d] = {
        progress: carryP,
        status: carryS,
        changed: Boolean(cell),
        by: cell ? [...cell.by] : [],
        events: cell?.events ?? 0,
        ...(createdDay && d < createdDay ? { notYet: true } : {}),
      };
    }

    tickets.push({
      ...ref,
      priority: t.priority ?? "medium",
      status: t.status,
      assignee: t.assignee ? { _id: String(t.assignee._id), name: t.assignee.name } : null,
      collaborators: (t.collaborators ?? []).filter(Boolean).map((c) => ({ _id: String(c._id), name: c.name })),
      start: startV,
      end: carryP,
      isNew,
      completed,
      blocked,
      contributors: [...contributors.entries()]
        .map(([id, n]) => ({ _id: id, name: people.get(id)?.name ?? "Unknown", events: n }))
        .sort((a, b) => b.events - a.events),
      days: dayCells,
    });
  }
  tickets.sort((a, b) => Number(b.completed) - Number(a.completed) || b.end - b.start - (a.end - a.start) || a.key.localeCompare(b.key));

  // ---------- EOD notes ----------
  for (const l of logs) {
    if (l.type !== "eod_note" || !l.user) continue;
    const meta = l.meta as Meta;
    const text = typeof meta?.text === "string" ? meta.text : l.message;
    person(String(l.user)).eodNotes.push({ at: l.createdAt.toISOString(), text });
    note(String(l.user), l.createdAt, { kind: "eod", text });
  }
  // EODs written on the EOD page count too (unless they also sent one in Telegram that day).
  const pageEods = await ReportDoc.find({ period: "day", key: { $in: days }, user: { $in: [...people.keys()] }, summary: { $ne: "" } })
    .select("user key summary updatedAt")
    .lean();
  for (const d of pageEods) {
    const p = people.get(String(d.user));
    if (!p || p.days[d.key]?.events.some((e) => e.kind === "eod")) continue;
    const at = new Date(Math.min(d.updatedAt.getTime(), startOfDay(addDays(d.key, 1), tz).getTime() - 1000)).toISOString();
    p.eodNotes.push({ at, text: d.summary });
    dayOf(p, d.key).events.push({ at, kind: "eod", text: d.summary });
  }

  // ---------- online / break time (presence is global, not per team) ----------
  const ids = [...people.keys()].map((id) => new Types.ObjectId(id));
  if (ids.length && clipEnd > start) {
    const [baseline, changes] = await Promise.all([
      ActivityLog.aggregate<{ _id: Types.ObjectId; to: string }>([
        { $match: { type: "status_change", user: { $in: ids }, createdAt: { $lt: start } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$user", to: { $first: "$meta.to" } } },
      ]),
      ActivityLog.find({ type: "status_change", user: { $in: ids }, createdAt: { $gte: start, $lt: clipEnd } })
        .sort({ createdAt: 1 })
        .select("user createdAt meta")
        .lean(),
    ]);
    const state = new Map(baseline.map((b) => [String(b._id), b.to]));
    const since = new Map<string, number>();
    // Add time spent in the current state up to `until`, split across calendar days.
    const add = (id: string, until: number) => {
      const s = state.get(id);
      const from = since.get(id) ?? start.getTime();
      const p = people.get(id);
      if (!p || until <= from || (s !== "online" && s !== "break")) return;
      for (const b of dayBounds) {
        const ms = Math.min(until, b.end) - Math.max(from, b.start);
        if (ms <= 0) continue;
        const d = dayOf(p, b.day);
        if (s === "online") d.onlineMinutes += ms / 60000;
        else d.breakMinutes += ms / 60000;
      }
    };
    for (const c of changes) {
      const id = String(c.user);
      const to = String((c.meta as Meta)?.to ?? "offline");
      const note2 = (c.meta as Meta)?.note;
      add(id, c.createdAt.getTime());
      state.set(id, to);
      since.set(id, c.createdAt.getTime());
      const p = people.get(id);
      if (!p) continue;
      const d = dayOf(p, dayKey(c.createdAt, tz));
      if (to === "online" && !d.firstOnline) d.firstOnline = c.createdAt.toISOString();
      d.events.push({ at: c.createdAt.toISOString(), kind: "presence", text: `${PRESENCE_TEXT[to] ?? to}${typeof note2 === "string" && note2 ? ` — ${note2}` : ""}` });
    }
    for (const id of people.keys()) add(id, clipEnd.getTime());
    for (const p of people.values()) {
      for (const d of Object.values(p.days)) {
        d.onlineMinutes = Math.round(d.onlineMinutes);
        d.breakMinutes = Math.round(d.breakMinutes);
      }
      p.onlineMinutes = Object.values(p.days).reduce((n, d) => n + d.onlineMinutes, 0);
      p.breakMinutes = Object.values(p.days).reduce((n, d) => n + d.breakMinutes, 0);
    }
  }

  // Late against the team's shift start.
  if (team.shiftStart) {
    const [sh, sm] = team.shiftStart.split(":").map(Number);
    for (const p of people.values()) {
      for (const b of dayBounds) {
        const d = p.days[b.day];
        if (!d?.firstOnline) continue;
        const shiftAt = startOfDay(b.day, tz).getTime() + (sh * 60 + sm) * 60000;
        const lateBy = Math.round((new Date(d.firstOnline).getTime() - shiftAt) / 60000);
        if (lateBy > LATE_GRACE_MIN) {
          d.lateBy = lateBy;
          p.lateDays++;
        }
      }
    }
  }
  for (const p of people.values()) for (const d of Object.values(p.days)) d.events.sort((a, b) => a.at.localeCompare(b.at));

  const members = [...people.values()]
    .filter((p) => p.inTeam || p.events || p.eodNotes.length)
    .sort((a, b) => Number(b.inTeam) - Number(a.inTeam) || b.events - a.events || a.name.localeCompare(b.name));

  const missingEod =
    period === "day"
      ? members
          .filter((m) => m.inTeam && !m.eodNotes.length && !(m.position && POSITION_GROUP[m.position] === "management"))
          .map((m) => m.name)
      : [];

  return {
    team: {
      _id: String(team._id),
      name: team.name,
      color: team.color,
      telegramLinked: Boolean(team.telegramChatId),
      shiftStart: team.shiftStart ?? null,
      shiftEnd: team.shiftEnd ?? null,
      lead: team.lead && !hide.has(String(team.lead._id)) ? team.lead.name : null,
      manager: team.manager && !hide.has(String(team.manager._id)) ? team.manager.name : null,
    },
    period,
    from,
    to,
    days,
    workDays: period === "day" ? 1 : days.filter((d) => reportWorkDays().includes(weekdayOf(d))).length || days.length,
    timeZone: tz,
    generatedAt: new Date().toISOString(),
    totals: {
      completed: tickets.filter((t) => t.completed).length,
      progressUpdates,
      created: tickets.filter((t) => t.isNew).length,
      blocked: tickets.filter((t) => t.blocked).length,
      activePeople: members.filter((m) => m.events || m.eodNotes.length).length,
      eodNotes: members.reduce((n, m) => n + m.eodNotes.length, 0),
    },
    members,
    tickets,
    missingEod,
  };
}

// ---------- CSV download ----------

/** e.g. "mobile-team-eod-2026-10-27.csv" */
export function reportFileName(r: TeamReport, ext: "csv" | "txt") {
  const slug = r.team.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "team";
  return `${slug}-${r.period === "day" ? "eod" : "eow"}-${r.from}.${ext}`;
}

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // don't let spreadsheets run it as a formula
  return `"${safe.replace(/"/g, '""')}"`;
}

/** One CSV with sections: summary, tickets day by day, people, and each person's day-by-day activity. */
export function formatReportCsv(r: TeamReport): string {
  const tz = r.timeZone;
  const time = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
  const rows: unknown[][] = [];
  const kind = r.period === "day" ? "EOD" : "EOW";
  rows.push([`${kind} report`, r.team.name, r.period === "day" ? r.from : `${r.from} to ${r.to}`, `Timezone ${tz}`]);
  if (r.team.shiftStart) rows.push(["Shift", `${r.team.shiftStart}–${r.team.shiftEnd}`]);
  if (r.team.lead || r.team.manager) rows.push(["Team Lead", r.team.lead ?? "", "Manager", r.team.manager ?? ""]);
  rows.push([]);
  rows.push(["Completed", "Progress updates", "New tickets", "Blocked", "Active people", "EOD notes"]);
  rows.push([r.totals.completed, r.totals.progressUpdates, r.totals.created, r.totals.blocked, r.totals.activePeople, r.totals.eodNotes]);

  rows.push([], ["TICKETS — progress at end of each day"]);
  rows.push(["Ticket", "Title", "Assignee", "Collaborators", "Priority", "Status now", "Start %", "End %", ...r.days.map((d) => d), "Worked on by"]);
  for (const t of r.tickets) {
    rows.push([
      t.key,
      t.title,
      t.assignee?.name ?? "",
      t.collaborators.map((c) => c.name).join(", "),
      t.priority,
      t.status,
      t.start,
      t.end,
      ...r.days.map((d) => {
        const c = t.days[d];
        if (!c || c.notYet) return "";
        return c.changed ? `${c.progress}% *` : `${c.progress}%`;
      }),
      t.contributors.map((c) => `${c.name} (${c.events})`).join(", "),
    ]);
  }
  rows.push(["", "* = changed that day"]);

  rows.push([], ["PEOPLE"]);
  rows.push(["Name", "In team", "Completed", "Ticket actions", "Online (min)", "Break (min)", "Late days", "Active days", "EOD notes"]);
  for (const m of r.members) {
    rows.push([m.name, m.inTeam ? "yes" : "no", m.completed.length, m.events, m.onlineMinutes, m.breakMinutes, m.lateDays, m.activeDays.length, m.eodNotes.map((n) => n.text).join(" | ")]);
  }

  rows.push([], ["PEOPLE — DAY BY DAY"]);
  rows.push(["Name", "Day", "First online", "Late by (min)", "Online (min)", "Break (min)", "Last active", "What happened"]);
  for (const m of r.members) {
    for (const d of r.days) {
      const day = m.days[d];
      if (!day) continue;
      rows.push([
        m.name,
        d,
        time(day.firstOnline),
        day.lateBy ?? "",
        day.onlineMinutes,
        day.breakMinutes,
        time(day.lastActive),
        day.events.map((e) => `${time(e.at)} ${e.ticket ? `${e.ticket.key} ${e.ticket.title}: ` : ""}${e.text}`).join(" | "),
      ]);
    }
  }
  // BOM so Excel opens UTF-8 correctly.
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

// ---------- plain-text version for Telegram / copying ----------

export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

const MAX_ITEMS = 10;
function list<T>(items: T[], line: (x: T) => string) {
  const shown = items.slice(0, MAX_ITEMS).map((x) => `• ${line(x)}`);
  if (items.length > MAX_ITEMS) shown.push(`…and ${items.length - MAX_ITEMS} more`);
  return shown.join("\n");
}

export function formatReportText(r: TeamReport): string {
  const title =
    r.period === "day"
      ? `📋 EOD · ${r.team.name} · ${formatDay(r.from, { weekday: "short", day: "numeric", month: "short" })}`
      : `📊 EOW · ${r.team.name} · ${formatDay(r.from, { day: "numeric", month: "short" })} – ${formatDay(r.to, { day: "numeric", month: "short" })}`;
  const t = r.totals;
  const out: string[] = [title];
  if (r.team.shiftStart && r.team.shiftEnd) out.push(`🕘 Shift ${r.team.shiftStart}–${r.team.shiftEnd}`);
  out.push(`✅ ${t.completed} done · 📈 ${t.progressUpdates} progress updates · 🆕 ${t.created} new · ⛔ ${t.blocked} blocked`);

  const names = (ids: { name: string }[]) => ids.map((c) => c.name).join(", ");
  const done = r.tickets.filter((x) => x.completed);
  const moved = r.tickets.filter((x) => !x.completed && x.end !== x.start);
  const blocked = r.tickets.filter((x) => x.blocked && x.status === "blocked");
  const created = r.tickets.filter((x) => x.isNew);

  if (done.length) out.push(`\n✅ Completed\n${list(done, (x) => `${x.key} ${x.title} — ${names(x.contributors) || x.assignee?.name || ""}`)}`);
  if (moved.length) out.push(`\n📈 Progress\n${list(moved, (x) => `${x.key} ${x.title} ${x.start}% → ${x.end}% (${names(x.contributors)})`)}`);
  if (blocked.length) out.push(`\n⛔ Blocked\n${list(blocked, (x) => `${x.key} ${x.title}${x.assignee ? ` — ${x.assignee.name}` : ""}`)}`);
  if (created.length) out.push(`\n🆕 New tickets\n${list(created, (x) => `${x.key} ${x.title}${x.assignee ? ` → ${x.assignee.name}` : ""}`)}`);
  if (!done.length && !moved.length && !created.length && !blocked.length) out.push("\nNo ticket updates in this period.");

  const people = r.members.filter((m) => m.inTeam || m.events);
  if (people.length) {
    out.push(
      `\n👥 People\n${list(people, (m) => {
        const bits = [
          m.completed.length && `${m.completed.length} done`,
          m.events && `${m.events} ticket action${m.events === 1 ? "" : "s"}`,
          r.period === "week" && m.activeDays.length && `active ${m.activeDays.length}/${r.workDays} days`,
          m.onlineMinutes && `online ${formatDuration(m.onlineMinutes)}`,
          m.lateDays &&
            (r.period === "day"
              ? `⏰ late ${m.days[r.from]?.lateBy ?? 0}m`
              : `⏰ late ${m.lateDays} day${m.lateDays === 1 ? "" : "s"}`),
        ].filter(Boolean);
        return `${m.name} — ${bits.length ? bits.join(" · ") : "no updates"}`;
      })}`,
    );
  }

  const notes = r.members.flatMap((m) => m.eodNotes.map((n) => ({ name: m.name, ...n })));
  if (notes.length) out.push(`\n📝 EOD notes\n${list(notes, (n) => `${n.name}: ${n.text.length > 300 ? `${n.text.slice(0, 300)}…` : n.text}`)}`);
  if (r.missingEod.length) out.push(`\n⏳ No EOD note yet: ${r.missingEod.join(", ")}`);

  const text = out.join("\n");
  return text.length > 4000 ? `${text.slice(0, 3990)}\n…` : text; // Telegram limit is 4096
}
