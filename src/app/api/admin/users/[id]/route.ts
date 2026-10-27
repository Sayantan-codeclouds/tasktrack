import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { jsonError, withUser } from "@/lib/api";
import { deleteUser } from "@/lib/userAdmin";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/admin/users/<id>?block=1 — admin only: delete someone (and optionally block them for good). */
export const DELETE = withUser<Ctx>(async (req, { params, user }) => {
  // Doesn't exist for anyone but the admin.
  if (user.role !== "admin") return jsonError("Not found", 404);
  const { id } = await params;
  if (!isValidObjectId(id)) return jsonError("Person not found", 404);
  const block = new URL(req.url).searchParams.get("block") === "1";
  const res = await deleteUser(id, user, { block });
  if (!res.ok) return jsonError(res.error, res.status);
  return NextResponse.json(res);
});
