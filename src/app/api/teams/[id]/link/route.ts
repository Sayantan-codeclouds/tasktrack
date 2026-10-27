import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { LINK_CODE_TTL_MS, newLinkCode } from "@/lib/linkCode";
import { unlinkTeamChat } from "@/lib/teams";
import { loadManagedTeam } from "@/lib/teamApi";

type Ctx = { params: Promise<{ id: string }> };

/** A code a manager sends as `/link CODE` inside the team's Telegram group. */
export const POST = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  const found = await loadManagedTeam(id, user);
  if (!found.ok) return found.error;
  found.team.linkCode = await newLinkCode();
  found.team.linkCodeExpires = new Date(Date.now() + LINK_CODE_TTL_MS);
  await found.team.save();
  return NextResponse.json({ code: found.team.linkCode, expires: found.team.linkCodeExpires });
});

/** Disconnect the team's Telegram group. */
export const DELETE = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  const found = await loadManagedTeam(id, user);
  if (!found.ok) return found.error;
  await unlinkTeamChat(id, { source: "web", actorId: user._id });
  return NextResponse.json({ ok: true });
});
