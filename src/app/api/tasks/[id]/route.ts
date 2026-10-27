import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { jsonError, withUser } from "@/lib/api";
import { Task } from "@/lib/models/Task";
import { Team } from "@/lib/models/Team";
import { deleteTask, updateTask } from "@/lib/services";
import { teamIdsForUser } from "@/lib/teams";
import { PRIORITY, TASK_STATUS, canDeleteAnyTicket, canEditTicket, isManagerOrAbove } from "@/lib/constants";
import type { IUser } from "@/lib/models/User";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().max(2000).nullish(),
  assigneeId: z.string().refine(isValidObjectId, "Invalid assignee").nullish(),
  teamId: z.string().refine(isValidObjectId, "Invalid team").nullish(),
  collaboratorIds: z.array(z.string().refine(isValidObjectId, "Invalid collaborator")).max(20).optional(),
  dueDate: z.iso.date().nullish(),
  progress: z.number().min(0).max(100).nullish(),
  status: z.enum(TASK_STATUS).nullish(),
  priority: z.enum(PRIORITY).nullish(),
  note: z.string().max(300).nullish(),
});

async function loadEditable(id: string, user: IUser) {
  if (!isValidObjectId(id)) return null;
  const task = await Task.findById(id).select("assignee createdBy team collaborators").lean();
  if (!task) return null;
  const actor = {
    _id: String(user._id),
    role: user.role,
    position: user.position,
    teamIds: await teamIdsForUser(user._id),
  };
  const ticket = {
    team: task.team ? String(task.team) : null,
    assigneeId: task.assignee ? String(task.assignee) : null,
    createdById: task.createdBy ? String(task.createdBy) : null,
    collaboratorIds: (task.collaborators ?? []).map(String),
  };
  return {
    task,
    actor,
    allowed: canEditTicket(actor, ticket),
    canDelete: canDeleteAnyTicket(actor) || ticket.createdById === actor._id,
  };
}

export const PATCH = withUser<Ctx>(async (req, { params, user }) => {
  const { id } = await params;
  const found = await loadEditable(id, user);
  if (!found) return jsonError("Task not found", 404);
  if (!found.allowed) {
    return jsonError("Only the assignee, the creator, the team's Team Lead or a Manager can edit this ticket", 403);
  }

  const body = Body.parse(await req.json());
  if (body.teamId && body.teamId !== String(found.task.team ?? "")) {
    if (!(await Team.exists({ _id: body.teamId }))) return jsonError("Team not found", 404);
    if (!isManagerOrAbove(found.actor) && !found.actor.teamIds.includes(body.teamId)) {
      return jsonError("You can only move tickets into teams you belong to", 403);
    }
  }
  const result = await updateTask(
    id,
    {
      title: body.title,
      description: body.description,
      assigneeId: body.assigneeId,
      teamId: body.teamId,
      collaboratorIds: body.collaboratorIds,
      dueDate: body.dueDate === undefined ? undefined : body.dueDate ? new Date(body.dueDate) : null,
      progress: body.progress,
      status: body.status,
      priority: body.priority,
      note: body.note,
    },
    { source: "web", actorId: user._id },
  );
  return NextResponse.json({ task: result?.task });
});

export const DELETE = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  const found = await loadEditable(id, user);
  if (!found) return jsonError("Task not found", 404);
  if (!found.canDelete) return jsonError("Only the creator or a Manager and above can delete this ticket", 403);
  await deleteTask(id, { source: "web", actorId: user._id });
  return NextResponse.json({ ok: true });
});
