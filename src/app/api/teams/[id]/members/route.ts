import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { jsonError, withUser } from "@/lib/api";
import { User } from "@/lib/models/User";
import { addMember } from "@/lib/teams";
import { loadManagedTeam } from "@/lib/teamApi";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ userId: z.string().refine(isValidObjectId, "Invalid member") });

/** Manual add — normally people join by being added to the team's Telegram group. */
export const POST = withUser<Ctx>(async (req, { params, user }) => {
  const { id } = await params;
  const found = await loadManagedTeam(id, user);
  if (!found.ok) return found.error;
  const { userId } = Body.parse(await req.json());
  if (!(await User.exists({ _id: userId }))) return jsonError("Member not found", 404);
  await addMember(id, userId, "web", { source: "web", actorId: user._id });
  return NextResponse.json({ ok: true });
});
