import { isValidObjectId } from "mongoose";
import { jsonError, withUser } from "@/lib/api";
import { User } from "@/lib/models/User";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/users/<id>/avatar?v=<version> — someone's profile photo. The version in the URL makes it safe to cache forever. */
export const GET = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  if (!isValidObjectId(id)) return jsonError("Not found", 404);
  // Not .lean(): that hands back the photo as a BSON Binary, which would be sent as an empty file.
  const target = await User.findById(id).select("+avatar avatarType role");
  // The admin doesn't exist for anyone else.
  if (!target?.avatar || !target.avatarType || (target.role === "admin" && user.role !== "admin")) return jsonError("Not found", 404);
  return new Response(new Uint8Array(target.avatar), {
    headers: {
      "Content-Type": target.avatarType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
});
