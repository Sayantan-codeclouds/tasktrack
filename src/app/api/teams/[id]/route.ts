import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { jsonError, withUser } from "@/lib/api";
import { User } from "@/lib/models/User";
import { deleteTeam, updateTeam } from "@/lib/teams";
import { actorOf, loadManagedTeam } from "@/lib/teamApi";
import { logActivity } from "@/lib/services";
import { canBeTeamLead, canBeTeamManager, isHhmm, isManagerOrAbove } from "@/lib/constants";

type Ctx = { params: Promise<{ id: string }> };

const Time = z.string().refine(isHhmm, "Use HH:MM (24h)").nullable().optional();
const Body = z.object({
  name: z.string().trim().min(2, "Team name is too short").max(40).optional(),
  description: z.string().trim().max(200).nullish(),
  reportsEnabled: z.boolean().optional(),
  leadId: z.string().refine(isValidObjectId, "Invalid Team Lead").nullable().optional(),
  managerId: z.string().refine(isValidObjectId, "Invalid Manager").nullable().optional(),
  shiftStart: Time,
  shiftEnd: Time,
});

export const PATCH = withUser<Ctx>(async (req, { params, user }) => {
  const { id } = await params;
  const found = await loadManagedTeam(id, user);
  if (!found.ok) return found.error;
  const team = found.team;
  const actor = actorOf(user);
  const body = Body.parse(await req.json());

  if (body.leadId !== undefined) {
    if (!isManagerOrAbove(actor)) return jsonError("Only Managers can change a team's Team Lead", 403);
    if (body.leadId) {
      const lead = await User.findById(body.leadId).select("position role").lean();
      if (!lead || lead.role === "admin" || !canBeTeamLead(lead.position)) return jsonError("The Team Lead must have the Team Lead role (or above)", 400);
    }
  }
  if (body.managerId !== undefined) {
    const isLead = String(team.lead ?? "") === actor._id;
    if (!isManagerOrAbove(actor) && !isLead) return jsonError("Only the team's Team Lead or a Manager can assign the overseeing Manager", 403);
    if (body.managerId) {
      const mgr = await User.findById(body.managerId).select("position role").lean();
      if (!mgr || mgr.role === "admin" || !canBeTeamManager(mgr.position)) return jsonError("The overseeing Manager must have a Manager role", 400);
    }
  }
  const start = body.shiftStart !== undefined ? body.shiftStart : team.shiftStart;
  const end = body.shiftEnd !== undefined ? body.shiftEnd : team.shiftEnd;
  if ((start && !end) || (!start && end)) return jsonError("Set both a shift start and end time", 400);
  if (start && end && start === end) return jsonError("Shift start and end can't be the same", 400);

  if (body.reportsEnabled !== undefined && body.reportsEnabled !== team.reportsEnabled) {
    team.reportsEnabled = body.reportsEnabled;
    await team.save();
    await logActivity(
      { type: "team_updated", team: team._id, message: `${user.name} turned ${body.reportsEnabled ? "on" : "off"} automatic EOD/EOW posts for ${team.name}` },
      { source: "web", actorId: user._id },
    );
  }
  await updateTeam(
    id,
    {
      name: body.name,
      description: body.description,
      leadId: body.leadId,
      managerId: body.managerId,
      shiftStart: body.shiftStart,
      shiftEnd: body.shiftEnd,
    },
    { source: "web", actorId: user._id },
  );
  return NextResponse.json({ ok: true });
});

export const DELETE = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  const found = await loadManagedTeam(id, user);
  if (!found.ok) return found.error;
  if (!isManagerOrAbove(actorOf(user)) && String(found.team.createdBy ?? "") !== String(user._id)) {
    return jsonError("Only Managers, or whoever created the team, can delete it", 403);
  }
  await deleteTeam(id, { source: "web", actorId: user._id });
  return NextResponse.json({ ok: true });
});
