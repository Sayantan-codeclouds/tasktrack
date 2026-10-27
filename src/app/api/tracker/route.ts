import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { User, PUBLIC_USER_FIELDS } from "@/lib/models/User";
import { Task } from "@/lib/models/Task";
import { Team } from "@/lib/models/Team";
import { ensureTicketNumbers } from "@/lib/services";
import { hiddenIdsFor } from "@/lib/admin";

export const dynamic = "force-dynamic";

const DONE_WINDOW_DAYS = 30;

// Tasks created before ticket numbers existed get numbered once per server start.
let backfilled: Promise<unknown> | null = null;

export const GET = withUser(async (_req, { user }) => {
  backfilled ??= ensureTicketNumbers().catch(() => (backfilled = null));
  await backfilled;
  const doneSince = new Date(Date.now() - DONE_WINDOW_DAYS * 86_400_000);

  const hidden = new Set(await hiddenIdsFor(user));
  const [members, allTasks, teams] = await Promise.all([
    // The admin account is invisible to everyone else.
    User.find(hidden.size ? { _id: { $nin: [...hidden] } } : {}).select(PUBLIC_USER_FIELDS).sort({ name: 1 }).lean(),
    // (teams fetched alongside so the board can switch between them)
    Task.find({ $or: [{ status: { $ne: "done" } }, { completedAt: { $gte: doneSince } }] })
      .populate("assignee", "name")
      .populate("collaborators", "name")
      .populate("createdBy", "name")
      .sort({ updatedAt: -1 })
      .lean(),
    Team.find().select("name color members.user telegramChatId lead manager shiftStart shiftEnd").sort({ name: 1 }).lean(),
  ]);
  // Hide the admin's own tickets and any trace of them on other tickets.
  type Ref = { _id: unknown; name: string } | null;
  const isHidden = (r: unknown) => !!r && hidden.has(String((r as { _id: unknown })._id));
  const tasks = hidden.size
    ? allTasks
        .filter((t) => !isHidden(t.assignee) && !(!t.assignee && isHidden(t.createdBy)))
        .map((t) => ({
          ...t,
          createdBy: isHidden(t.createdBy) ? null : t.createdBy,
          collaborators: ((t.collaborators ?? []) as unknown as Ref[]).filter((c) => !isHidden(c)),
        }))
    : allTasks;

  const me = String(user._id);
  const myTeamIds = teams
    .filter((t) => t.members.some((m) => String(m.user) === me) || String(t.lead ?? "") === me || String(t.manager ?? "") === me)
    .map((t) => String(t._id));

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const openByUser = new Map<string, number>();
  for (const t of tasks) {
    if (t.status === "done") continue;
    // Count a ticket for its assignee and everyone working on it with them.
    const people = [t.assignee, ...(t.collaborators ?? [])] as unknown as ({ _id: unknown } | null)[];
    for (const p of people) {
      if (!p) continue;
      const id = String(p._id);
      openByUser.set(id, (openByUser.get(id) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    me: { _id: String(user._id), role: user.role, position: user.position ?? null, teamIds: myTeamIds },
    members: members.map((m) => ({ ...m, openTasks: openByUser.get(String(m._id)) ?? 0 })),
    tasks,
    teams: teams.map((t) => ({
      _id: String(t._id),
      name: t.name,
      color: t.color,
      telegramLinked: Boolean(t.telegramChatId),
      memberIds: t.members.map((m) => String(m.user)).filter((id) => !hidden.has(id)),
      leadId: t.lead && !hidden.has(String(t.lead)) ? String(t.lead) : null,
      managerId: t.manager && !hidden.has(String(t.manager)) ? String(t.manager) : null,
      shiftStart: t.shiftStart ?? null,
      shiftEnd: t.shiftEnd ?? null,
    })),
    stats: {
      online: members.filter((m) => m.presence === "online").length,
      onBreak: members.filter((m) => m.presence === "break").length,
      offline: members.filter((m) => m.presence === "offline").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
      doneToday: tasks.filter((t) => t.completedAt && t.completedAt >= startOfDay).length,
    },
  });
});
