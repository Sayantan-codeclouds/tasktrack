import { NextResponse } from "next/server";
import { jsonError, withUser } from "@/lib/api";
import { User } from "@/lib/models/User";
import { Task } from "@/lib/models/Task";
import { Team } from "@/lib/models/Team";
import { ActivityLog } from "@/lib/models/ActivityLog";
import { SystemStatus } from "@/lib/models/SystemStatus";
import { BlockedIdentity } from "@/lib/models/BlockedIdentity";
import { appTimeZone, dayKey, startOfDay } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Bot counts as running if it checked in within this window (worker: every minute; webhook mode: each cron call). */
const BOT_STALE_MS = 12 * 60_000;

/** Everything the /admin page watches. Admins only. */
export const GET = withUser(async (_req, { user }) => {
  // Doesn't exist for anyone but the admin.
  if (user.role !== "admin") return jsonError("Not found", 404);

  const tz = appTimeZone();
  const today = startOfDay(dayKey(new Date(), tz), tz);
  const [users, tasks, teams, lastByTeam, bot, blocked] = await Promise.all([
    User.find()
      .select("name email role position presence presenceNote presenceSince lastSeenAt telegramId telegramUsername createdAt")
      .sort({ name: 1 })
      .lean(),
    Task.find().select("status team assignee completedAt dueDate").lean(),
    Team.find().select("name color members.user telegramChatId telegramChatTitle reportsEnabled").sort({ name: 1 }).lean(),
    ActivityLog.aggregate<{ _id: unknown; at: Date }>([{ $match: { team: { $ne: null } } }, { $group: { _id: "$team", at: { $max: "$createdAt" } } }]),
    SystemStatus.findById("bot").lean(),
    BlockedIdentity.find().sort({ createdAt: -1 }).lean(),
  ]);

  const presenceOf = new Map(users.map((u) => [String(u._id), u.presence]));
  const teamNamesByUser = new Map<string, string[]>();
  for (const t of teams) {
    for (const m of t.members) {
      const id = String(m.user);
      teamNamesByUser.set(id, [...(teamNamesByUser.get(id) ?? []), t.name]);
    }
  }
  const lastActivity = new Map(lastByTeam.map((r) => [String(r._id), r.at]));
  const todayUtcMidnight = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const isOpen = (t: (typeof tasks)[number]) => t.status !== "done";
  const doneToday = (t: (typeof tasks)[number]) => !!t.completedAt && t.completedAt >= today;
  const overdue = (t: (typeof tasks)[number]) => isOpen(t) && !!t.dueDate && t.dueDate.getTime() < todayUtcMidnight;

  const openByUser = new Map<string, number>();
  for (const t of tasks) if (isOpen(t) && t.assignee) openByUser.set(String(t.assignee), (openByUser.get(String(t.assignee)) ?? 0) + 1);

  return NextResponse.json({
    me: String(user._id),
    bot: bot
      ? {
          online: Date.now() - new Date(bot.lastSeenAt).getTime() < BOT_STALE_MS,
          lastSeenAt: bot.lastSeenAt,
          startedAt: bot.startedAt,
          username: (bot.info as { username?: string } | null)?.username ?? null,
        }
      : { online: false, lastSeenAt: null, startedAt: null, username: null },
    stats: {
      people: users.length,
      online: users.filter((u) => u.presence === "online").length,
      onBreak: users.filter((u) => u.presence === "break").length,
      offline: users.filter((u) => u.presence === "offline").length,
      telegramLinked: users.filter((u) => u.telegramId).length,
      noRole: users.filter((u) => !u.position && u.role !== "admin").length,
      open: tasks.filter(isOpen).length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
      doneToday: tasks.filter(doneToday).length,
      overdue: tasks.filter(overdue).length,
      teams: teams.length,
      teamsConnected: teams.filter((t) => t.telegramChatId).length,
    },
    teams: teams.map((t) => {
      const mine = tasks.filter((x) => String(x.team ?? "") === String(t._id));
      const memberIds = t.members.map((m) => String(m.user));
      return {
        _id: String(t._id),
        name: t.name,
        color: t.color,
        connected: Boolean(t.telegramChatId),
        chatTitle: t.telegramChatTitle ?? null,
        reportsEnabled: t.reportsEnabled !== false,
        members: memberIds.length,
        online: memberIds.filter((id) => presenceOf.get(id) === "online").length,
        onBreak: memberIds.filter((id) => presenceOf.get(id) === "break").length,
        open: mine.filter(isOpen).length,
        inProgress: mine.filter((x) => x.status === "in_progress").length,
        blocked: mine.filter((x) => x.status === "blocked").length,
        doneToday: mine.filter(doneToday).length,
        overdue: mine.filter(overdue).length,
        lastActivityAt: lastActivity.get(String(t._id)) ?? null,
      };
    }),
    people: users.map((u) => ({
      _id: String(u._id),
      name: u.name,
      email: u.email,
      role: u.role,
      position: u.position ?? null,
      presence: u.presence,
      presenceNote: u.presenceNote ?? null,
      presenceSince: u.presenceSince,
      lastSeenAt: u.lastSeenAt ?? null,
      telegram: u.telegramId ? (u.telegramUsername ? `@${u.telegramUsername}` : "linked") : null,
      teams: teamNamesByUser.get(String(u._id)) ?? [],
      open: openByUser.get(String(u._id)) ?? 0,
      createdAt: u.createdAt,
    })),
    blocked: blocked.map((b) => ({
      _id: String(b._id),
      name: b.name,
      email: b.email ?? null,
      telegram: b.telegramUsername ? `@${b.telegramUsername}` : b.telegramId ? "linked" : null,
      createdAt: b.createdAt,
    })),
  });
});
