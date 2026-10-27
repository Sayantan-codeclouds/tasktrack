import { NextResponse } from "next/server";
import { jsonError, withUser } from "@/lib/api";
import { User, PUBLIC_USER_FIELDS } from "@/lib/models/User";
import { Task } from "@/lib/models/Task";
import { assignablePositions, canAssignRoles, canCreateTeams, canSetPosition } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Team directory with roles and ticket counts. Emails are only shown to people who can assign roles. */
export const GET = withUser(async (_req, { user }) => {
  const me = { _id: String(user._id), role: user.role, position: user.position ?? null };
  // The Team page is for Team Leads and Managers.
  if (!canCreateTeams(me)) return jsonError("Teams are managed by Team Leads and Managers", 403);
  const showEmail = canAssignRoles(me);

  const [members, counts] = await Promise.all([
    // The admin account is invisible to everyone else.
    User.find(user.role === "admin" ? {} : { role: { $ne: "admin" } })
      // Only the admin sees who is admin.
      .select(PUBLIC_USER_FIELDS + " requestedPosition" + (showEmail ? " email" : "") + (user.role === "admin" ? " role" : ""))
      .sort({ name: 1 })
      .lean(),
    Task.aggregate<{ _id: unknown; open: number; done: number }>([
      { $match: { assignee: { $ne: null } } },
      {
        $group: {
          _id: "$assignee",
          open: { $sum: { $cond: [{ $ne: ["$status", "done"] }, 1, 0] } },
          done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const byUser = new Map(counts.map((c) => [String(c._id), c]));

  return NextResponse.json({
    me: { ...me, canAssignRoles: showEmail, assignable: assignablePositions(me) },
    members: members.map((m) => {
      const target = { _id: String(m._id), position: m.position ?? null };
      return {
        ...m,
        role: user.role === "admin" ? m.role : "member",
        position: m.position ?? null,
        open: byUser.get(String(m._id))?.open ?? 0,
        done: byUser.get(String(m._id))?.done ?? 0,
        canEditRole: canSetPosition(me, target, null),
        requestedPosition: m.requestedPosition ?? null,
        // Can this viewer grant the role they asked for?
        canApprove: Boolean(m.requestedPosition) && canSetPosition(me, target, m.requestedPosition ?? null),
      };
    }),
  });
});
