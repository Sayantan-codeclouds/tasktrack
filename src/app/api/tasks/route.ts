import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { jsonError, withUser } from "@/lib/api";
import { Team } from "@/lib/models/Team";
import { createTask } from "@/lib/services";
import { PRIORITY } from "@/lib/constants";

const Body = z.object({
  title: z.string().trim().min(2, "Title is too short").max(200),
  description: z.string().max(2000).nullish(),
  assigneeId: z.string().refine(isValidObjectId, "Invalid assignee").nullish(),
  dueDate: z.iso.date().nullish(),
  progress: z.number().min(0).max(100).optional(),
  priority: z.enum(PRIORITY).optional(),
  teamId: z.string().refine(isValidObjectId, "Invalid team").nullish(),
  collaboratorIds: z.array(z.string().refine(isValidObjectId, "Invalid collaborator")).max(20).optional(),
});

export const POST = withUser(async (req, { user }) => {
  const body = Body.parse(await req.json());
  if (body.teamId && !(await Team.exists({ _id: body.teamId }))) return jsonError("Team not found", 404);
  const task = await createTask(
    {
      title: body.title,
      description: body.description,
      assigneeId: body.assigneeId ?? user._id,
      createdById: user._id,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      progress: body.progress,
      priority: body.priority,
      teamId: body.teamId ?? null,
      collaboratorIds: body.collaboratorIds,
    },
    { source: "web", actorId: user._id },
  );
  return NextResponse.json({ task }, { status: 201 });
});
