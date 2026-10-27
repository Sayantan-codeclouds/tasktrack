import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { jsonError, withUser } from "@/lib/api";
import { Team } from "@/lib/models/Team";
import { Task } from "@/lib/models/Task";
import { User } from "@/lib/models/User";
import { canBeTeamLead, canBeTeamManager, canCreateTeams, canManageTeam, isManagerOrAbove, type Position } from "@/lib/constants";
import { createTeam } from "@/lib/teams";
import { actorOf } from "@/lib/teamApi";
import { hiddenIdsFor } from "@/lib/admin";

export const dynamic = "force-dynamic";

type PersonRef = { _id: unknown; name: string; position: Position | null } | null;

export const GET = withUser(async (_req, { user }) => {
  const actor = actorOf(user);
  // The Team page is for Team Leads and Managers.
  if (!canCreateTeams(actor)) return jsonError("Teams are managed by Team Leads and Managers", 403);
  const hidden = new Set(await hiddenIdsFor(user));
  const [teams, counts] = await Promise.all([
    Team.find()
      .sort({ name: 1 })
      .populate<{ members: { user: { _id: unknown; name: string; position: Position | null; presence: string; telegramId: string | null } | null; via: string; addedAt: Date }[] }>(
        "members.user",
        "name position presence telegramId",
      )
      .populate<{ lead: PersonRef }>("lead", "name position")
      .populate<{ manager: PersonRef }>("manager", "name position")
      .lean(),
    Task.aggregate<{ _id: unknown; open: number; done: number }>([
      { $match: { team: { $ne: null } } },
      {
        $group: {
          _id: "$team",
          open: { $sum: { $cond: [{ $ne: ["$status", "done"] }, 1, 0] } },
          done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const byTeam = new Map(counts.map((c) => [String(c._id), c]));
  const now = new Date();
  const canCreate = canCreateTeams(actor);
  const rows = teams.map((t) => {
    const canManage = canManageTeam(actor, { lead: t.lead ? String(t.lead._id) : null, manager: t.manager ? String(t.manager._id) : null });
    return {
      _id: t._id,
      name: t.name,
      description: t.description,
      color: t.color,
      lead: t.lead && !hidden.has(String(t.lead._id)) ? { _id: String(t.lead._id), name: t.lead.name } : null,
      manager: t.manager && !hidden.has(String(t.manager._id)) ? { _id: String(t.manager._id), name: t.manager.name } : null,
      shiftStart: t.shiftStart ?? null,
      shiftEnd: t.shiftEnd ?? null,
      telegramLinked: Boolean(t.telegramChatId),
      telegramChatTitle: t.telegramChatTitle,
      telegramLinkedAt: t.telegramLinkedAt,
      reportsEnabled: t.reportsEnabled !== false,
      canManage,
      canChangeLead: isManagerOrAbove(actor),
      canDelete: isManagerOrAbove(actor) || String(t.createdBy ?? "") === actor._id,
      // Codes are only for the people who can use them.
      linkCode: canManage && t.linkCode && t.linkCodeExpires && t.linkCodeExpires > now ? t.linkCode : null,
      linkCodeExpires: canManage && t.linkCodeExpires && t.linkCodeExpires > now ? t.linkCodeExpires : null,
      members: t.members
        .filter((m) => m.user && !hidden.has(String(m.user._id)))
        .map((m) => ({ ...m.user!, via: m.via, addedAt: m.addedAt })),
      pending: t.pending,
      open: byTeam.get(String(t._id))?.open ?? 0,
      done: byTeam.get(String(t._id))?.done ?? 0,
      createdAt: t.createdAt,
    };
  });
  const needsPeople = canCreate || rows.some((r) => r.canManage);
  const users = needsPeople
    ? await User.find({ role: { $ne: "admin" } }).select("name position").sort({ name: 1 }).lean()
    : [];

  return NextResponse.json({
    me: { _id: actor._id, canCreate, canManage: rows.some((r) => r.canManage), isManager: isManagerOrAbove(actor) },
    users,
    teams: rows,
  });
});

const Body = z.object({
  name: z.string().trim().min(2, "Team name is too short").max(40),
  description: z.string().trim().max(200).nullish(),
  leadId: z.string().refine(isValidObjectId, "Invalid Team Lead").nullish(),
  managerId: z.string().refine(isValidObjectId, "Invalid Manager").nullish(),
});

/** Managers create a team and pick its Team Lead; Team Leads create one, lead it, and pick its Manager. */
export const POST = withUser(async (req, { user }) => {
  const actor = actorOf(user);
  if (!canCreateTeams(actor)) return jsonError("Only Team Leads and Managers can create teams", 403);
  const body = Body.parse(await req.json());
  if (await Team.exists({ name: { $regex: `^${body.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } })) {
    return jsonError("A team with that name already exists", 409);
  }

  const manager = isManagerOrAbove(actor);
  // A Team Lead always leads the team they create; a Manager oversees the team they create unless they pick someone else.
  const leadId = manager ? (body.leadId ?? null) : actor._id;
  const managerId = body.managerId ?? (manager && user.position ? actor._id : null);

  const [lead, mgr] = await Promise.all([
    leadId ? User.findById(leadId).select("position role").lean() : null,
    managerId ? User.findById(managerId).select("position role").lean() : null,
  ]);
  // The admin can't be a visible lead/manager (when the admin creates a team, they simply aren't on it).
  if (leadId && (!lead || lead.role === "admin" || !canBeTeamLead(lead.position))) {
    return jsonError("The Team Lead must have the Team Lead role (or above)", 400);
  }
  if (managerId && mgr?.role === "admin") {
    if (String(managerId) !== actor._id) return jsonError("The overseeing Manager must have a Manager role", 400);
  } else if (managerId && (!mgr || !canBeTeamManager(mgr.position))) {
    return jsonError("The overseeing Manager must have a Manager role", 400);
  }

  const team = await createTeam(
    { ...body, leadId, managerId: mgr?.role === "admin" ? null : managerId },
    { source: "web", actorId: user._id },
  );
  return NextResponse.json({ team }, { status: 201 });
});
