import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { jsonError, withUser } from "@/lib/api";
import { getImpersonatorId, startSession } from "@/lib/auth";
import { User } from "@/lib/models/User";

const Body = z.object({ userId: z.string() });

/** POST /api/admin/impersonate { userId } — the admin signs in as a member (1 hour; "Back to admin" ends it). */
export const POST = withUser(async (req, { user }) => {
  // Only the admin, from their own account — not while already viewing as someone.
  if (user.role !== "admin" || (await getImpersonatorId())) return jsonError("Not found", 404);
  const { userId } = Body.parse(await req.json());
  if (!isValidObjectId(userId)) return jsonError("Person not found", 404);
  const target = await User.findById(userId).select("name role sessionVersion");
  if (!target) return jsonError("Person not found", 404);
  if (String(target._id) === String(user._id) || target.role === "admin") return jsonError("You can't sign in as another admin", 400);
  console.log(`[admin] ${user.email} signed in as ${target.name} (${target._id})`);
  await startSession(target, { impersonatedBy: String(user._id) });
  return NextResponse.json({ ok: true, name: target.name });
});

/** DELETE /api/admin/impersonate — "Back to admin": leave the member's account and return to the admin's. */
export const DELETE = withUser(async () => {
  const adminId = await getImpersonatorId();
  const admin = adminId && isValidObjectId(adminId) ? await User.findById(adminId).select("role sessionVersion") : null;
  if (!admin || admin.role !== "admin") return jsonError("Not found", 404);
  await startSession(admin);
  return NextResponse.json({ ok: true });
});
