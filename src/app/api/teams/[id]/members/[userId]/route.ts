import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { jsonError, withUser } from "@/lib/api";
import { removeMember } from "@/lib/teams";
import { loadManagedTeam } from "@/lib/teamApi";

type Ctx = { params: Promise<{ id: string; userId: string }> };

export const DELETE = withUser<Ctx>(async (_req, { params, user }) => {
  const { id, userId } = await params;
  const found = await loadManagedTeam(id, user);
  if (!found.ok) return found.error;
  if (!isValidObjectId(userId)) return jsonError("Member not found", 404);
  await removeMember(id, userId, { source: "web", actorId: user._id });
  return NextResponse.json({ ok: true });
});
