import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { User } from "@/lib/models/User";
import { hiddenIdsFor } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** GET /api/avatars → { versions: { userId: version } } for everyone who has a photo. Small, fetched once per page. */
export const GET = withUser(async (_req, { user }) => {
  const hidden = await hiddenIdsFor(user);
  const users = await User.find({ avatarVersion: { $ne: null }, _id: { $nin: hidden } })
    .select("avatarVersion")
    .lean();
  return NextResponse.json({ versions: Object.fromEntries(users.map((u) => [String(u._id), u.avatarVersion])) });
});
