import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { jsonError, withUser } from "@/lib/api";
import { User } from "@/lib/models/User";
import { logActivity } from "@/lib/services";
import { POSITIONS, POSITION_LABEL, canSetPosition } from "@/lib/constants";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.union([
  z.object({ position: z.enum(POSITIONS).nullable() }),
  // Turn down the role someone asked for at sign-up.
  z.object({ declineRequest: z.literal(true) }),
]);

/** Change someone's job role — approving a sign-up request is just setting the requested role. */
export const PATCH = withUser<Ctx>(async (req, { params, user }) => {
  const { id } = await params;
  if (!isValidObjectId(id)) return jsonError("Member not found", 404);
  const body = Body.parse(await req.json());

  const target = await User.findById(id);
  // The admin account doesn't exist as far as anyone else is concerned.
  if (!target || (target.role === "admin" && user.role !== "admin")) return jsonError("Member not found", 404);

  const actor = { _id: String(user._id), role: user.role, position: user.position ?? null };
  const position = "position" in body ? body.position : (target.position ?? null);
  // Approving needs the same rights as giving that role directly; declining needs rights over the person.
  const allowed =
    "declineRequest" in body
      ? canSetPosition(actor, { _id: String(target._id), position: target.position ?? null }, null)
      : canSetPosition(actor, { _id: String(target._id), position: target.position ?? null }, position);
  if (!allowed) {
    return jsonError(
      actor._id === String(target._id)
        ? "You can't change your own role — ask your manager"
        : "You can only assign roles below your own, to people below you",
      403,
    );
  }

  const requested = target.requestedPosition ?? null;
  if ("declineRequest" in body) {
    if (!requested) return NextResponse.json({ ok: true });
    target.requestedPosition = null;
    await target.save();
    await logActivity(
      { type: "role_changed", user: target._id, message: `${user.name} declined ${target.name}'s request to be ${POSITION_LABEL[requested]}` },
      { source: "web", actorId: user._id },
    );
    return NextResponse.json({ ok: true });
  }

  const before = target.position ?? null;
  if (before === position && !requested) return NextResponse.json({ ok: true });
  target.position = position;
  target.requestedPosition = null; // any decision settles the request
  await target.save();
  if (before === position) return NextResponse.json({ ok: true });

  const label = (p: typeof position) => (p ? POSITION_LABEL[p] : "No role");
  await logActivity(
    {
      type: "role_changed",
      user: target._id,
      message:
        requested && requested === position
          ? `${user.name} approved ${target.name} as ${label(position)}`
          : `${user.name} changed ${target.name}'s role: ${label(before)} → ${label(position)}`,
      meta: { from: before, to: position, requested },
    },
    { source: "web", actorId: user._id },
  );
  return NextResponse.json({ ok: true });
});
