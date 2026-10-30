import { Types } from "mongoose";
import { ActivityLog } from "../src/lib/models/ActivityLog";
import { Task } from "../src/lib/models/Task";
import { Team } from "../src/lib/models/Team";
import { User, type IUser } from "../src/lib/models/User";
import { POSITION_LABEL, PRESENCE_LABEL, PRIORITY_LABEL, TASK_STATUS_LABEL, ticketKey } from "../src/lib/constants";
import { adminUserIds } from "../src/lib/admin";
import { overseenTeamIds } from "../src/lib/oversight";
import { teamIdsForUser } from "../src/lib/teams";

/**
 * How far back recent updates go, and how much goes to the AI. Kept small: Groq's free tier allows ~8,000
 * tokens a minute per model, and this is ~1,500 for a team.
 */
const UPDATE_DAYS = 2;
const DONE_DAYS = 14;
const MAX_TASKS = 120;
const MAX_UPDATES = 40;

/**
 * Everything the asker may see, as text for the AI to answer from: their teams (the group's team in a group;
 * in a private chat their own teams plus the ones they oversee), the people, the tickets and recent updates.
 */
export async function askContext(asker: IUser, groupTeamId: Types.ObjectId | null, howTo: string | null, timeZone: string) {
  let teamIds: string[] | null;
  if (groupTeamId) teamIds = [String(groupTeamId)];
  else {
    const overseen = await overseenTeamIds({ _id: asker._id, role: asker.role, position: asker.position ?? null });
    teamIds = overseen === null ? null : [...new Set([...(await teamIdsForUser(asker._id)), ...overseen])];
  }
  const hidden = new Set(await adminUserIds());

  const teams = await Team.find(teamIds ? { _id: { $in: teamIds } } : {})
    .select("name lead manager members.user shiftStart shiftEnd meetingUrl")
    .sort({ name: 1 })
    .lean();
  const peopleIds = [...new Set([String(asker._id), ...teams.flatMap((t) => [...t.members.map((m) => String(m.user)), ...[t.lead, t.manager].filter(Boolean).map(String)])])].filter(
    (id) => !hidden.has(id) || id === String(asker._id),
  );
  const people = await User.find({ _id: { $in: peopleIds } })
    .select("name position presence presenceNote presenceSince")
    .sort({ name: 1 })
    .lean();
  const name = new Map(people.map((p) => [String(p._id), p.name]));
  const teamName = new Map(teams.map((t) => [String(t._id), t.name]));

  const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const day = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(d);

  // Tickets: the teams' own, plus team-less ones on these people.
  const ids = (xs: string[]) => xs.map((x) => new Types.ObjectId(x));
  const where = {
    $or: [
      ...(teamIds ? [{ team: { $in: ids(teamIds) } }] : [{ team: { $ne: null } }]),
      { team: null, $or: [{ assignee: { $in: ids(peopleIds) } }, { collaborators: { $in: ids(peopleIds) } }] },
    ],
  };
  const since = new Date(Date.now() - DONE_DAYS * 86_400_000);
  // Open ones first, so a long done list never pushes them out.
  const open = await Task.find({ ...where, status: { $ne: "done" } }).sort({ updatedAt: -1 }).limit(MAX_TASKS).lean();
  const done = await Task.find({ ...where, status: "done", completedAt: { $gte: since } })
    .sort({ completedAt: -1 })
    .limit(Math.max(20, MAX_TASKS - open.length))
    .lean();
  const tasks = [...open, ...done];
  const who = (id?: Types.ObjectId | null) => (id ? (name.get(String(id)) ?? "someone outside these teams") : "unassigned");

  const updates = await ActivityLog.find({
    createdAt: { $gte: new Date(Date.now() - UPDATE_DAYS * 86_400_000) },
    // Who's online is in PEOPLE and new tickets are in TICKETS, so just the work.
    type: { $in: ["task_progress", "task_status", "task_completed", "eod_note"] },
    $or: [{ task: { $in: tasks.map((t) => t._id) } }, { user: { $in: ids(peopleIds) } }],
  })
    .sort({ createdAt: -1 })
    .limit(MAX_UPDATES)
    .select("type message createdAt user")
    .lean();

  const lines = [
    `TEAMS:\n${
      teams
        .map((t) =>
          [
            `• ${t.name}`,
            t.shiftStart && t.shiftEnd ? `shift ${t.shiftStart}–${t.shiftEnd}` : null,
            t.lead ? `Team Lead ${who(t.lead)}` : null,
            t.manager ? `Manager ${who(t.manager)}` : null,
            `${t.members.length} members`,
            t.meetingUrl ? `meeting link ${t.meetingUrl}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        )
        .join("\n") || "(none)"
    }`,
    `PEOPLE (right now):\n${people
      .map(
        (p) =>
          `• ${p.name}${p.position ? ` — ${POSITION_LABEL[p.position]}` : ""} · ${PRESENCE_LABEL[p.presence]} since ${time(p.presenceSince)}${p.presenceNote ? ` ("${p.presenceNote}")` : ""}`,
      )
      .join("\n")}`,
    `TICKETS (open, and done in the last ${DONE_DAYS} days):\n${
      tasks
        .map((t) =>
          [
            `• ${ticketKey(t.number)} "${t.title}"`,
            t.status === "done" ? `Done${t.completedAt ? ` ${time(t.completedAt)}` : ""}` : `${TASK_STATUS_LABEL[t.status]} ${t.progress}%`,
            `${who(t.assignee)}${t.collaborators?.length ? ` + ${t.collaborators.map(who).join(", ")}` : ""}`,
            t.dueDate ? `due ${day(t.dueDate)}` : null,
            t.priority === "high" || t.priority === "urgent" ? PRIORITY_LABEL[t.priority] : null,
            teams.length > 1 && t.team ? teamName.get(String(t.team)) : null,
            `updated ${time(t.updatedAt)}`,
            t.description ? `— ${t.description.slice(0, 120)}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        )
        .join("\n") || "(none)"
    }`,
    `RECENT UPDATES (last ${UPDATE_DAYS} days, newest first):\n${updates.map((u) => `• ${time(u.createdAt)} — ${u.message}`).join("\n") || "(none)"}`,
    howTo ? `HOW TO USE:\n${howTo}` : null,
  ];
  return lines.filter(Boolean).join("\n\n");
}
