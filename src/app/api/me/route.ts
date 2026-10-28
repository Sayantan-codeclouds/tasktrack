import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, withUser } from "@/lib/api";
import { Task } from "@/lib/models/Task";
import { Team } from "@/lib/models/Team";
import { getImpersonatorId, hashPassword, verifyPassword } from "@/lib/auth";
import { logActivity } from "@/lib/services";

export const dynamic = "force-dynamic";

export const GET = withUser(async (_req, { user }) => {
  const [counts] = await Task.aggregate<{
    total: number;
    done: number;
    open: number;
    avgOpenProgress: number | null;
  }>([
    { $match: { assignee: user._id } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
        open: { $sum: { $cond: [{ $ne: ["$status", "done"] }, 1, 0] } },
        avgOpenProgress: { $avg: { $cond: [{ $ne: ["$status", "done"] }, "$progress", null] } },
      },
    },
  ]);

  const teams = await Team.find({ "members.user": user._id }).select("name color telegramChatTitle").sort({ name: 1 }).lean();

  const linkCodeActive =
    user.linkCode && user.linkCodeExpires && user.linkCodeExpires > new Date() ? user.linkCode : null;

  return NextResponse.json({
    user: {
      _id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      position: user.position ?? null,
      requestedPosition: user.requestedPosition ?? null,
      presence: user.presence,
      presenceNote: user.presenceNote,
      presenceSince: user.presenceSince,
      lastSeenAt: user.lastSeenAt,
      telegramId: user.telegramId,
      telegramUsername: user.telegramUsername,
      linkCode: linkCodeActive,
      linkCodeExpires: linkCodeActive ? user.linkCodeExpires : null,
      createdAt: user.createdAt,
      hasPassword: Boolean(user.passwordHash),
      googleLinked: Boolean(user.googleId),
    },
    stats: {
      total: counts?.total ?? 0,
      done: counts?.done ?? 0,
      open: counts?.open ?? 0,
      avgOpenProgress: Math.round(counts?.avgOpenProgress ?? 0),
    },
    teams,
    botUsername: process.env.TELEGRAM_BOT_USERNAME || null,
    /** The admin is signed in as this person. */
    adminView: Boolean(await getImpersonatorId()),
  });
});

const Body = z.object({
  name: z.string().trim().min(2, "Name is too short").max(60).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, "New password must be at least 8 characters").max(200).optional(),
});

export const PATCH = withUser(async (req, { user }) => {
  const body = Body.parse(await req.json());
  const changed: string[] = [];

  if (body.name && body.name !== user.name) {
    user.name = body.name;
    changed.push("name");
  }
  if (body.newPassword) {
    if (await getImpersonatorId()) return jsonError("Passwords can't be changed while viewing as someone", 403);
    // Google-only accounts have no password yet, so there's nothing to confirm.
    if (user.passwordHash && (!body.currentPassword || !(await verifyPassword(body.currentPassword, user.passwordHash)))) {
      return jsonError("Current password is incorrect", 400);
    }
    user.passwordHash = await hashPassword(body.newPassword);
    changed.push("password");
  }
  if (!changed.length) return NextResponse.json({ ok: true });

  await user.save();
  await logActivity(
    { type: "profile_updated", user: user._id, message: `${user.name} updated their ${changed.join(" and ")}` },
    { source: "web" },
  );
  return NextResponse.json({ ok: true });
});
