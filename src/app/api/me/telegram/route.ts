import { NextResponse } from "next/server";
import { jsonError, withUser } from "@/lib/api";
import { getImpersonatorId } from "@/lib/auth";
import { logActivity } from "@/lib/services";
import { LINK_CODE_TTL_MS, newLinkCode } from "@/lib/linkCode";

/** Create a one-time code the user sends to the bot as `/link CODE`. */
export const POST = withUser(async (_req, { user }) => {
  // In Admin view, a code here would let the admin's own Telegram be linked to this person.
  if (await getImpersonatorId()) return jsonError("Telegram can't be linked while viewing as someone", 403);
  user.linkCode = await newLinkCode();
  user.linkCodeExpires = new Date(Date.now() + LINK_CODE_TTL_MS);
  await user.save();
  return NextResponse.json({ code: user.linkCode, expires: user.linkCodeExpires });
});

export const DELETE = withUser(async (_req, { user }) => {
  if (await getImpersonatorId()) return jsonError("Telegram can't be unlinked while viewing as someone", 403);
  if (!user.telegramId) return NextResponse.json({ ok: true });
  const handle = user.telegramUsername ? `@${user.telegramUsername}` : "their Telegram account";
  user.telegramId = null;
  user.telegramUsername = null;
  await user.save();
  await logActivity(
    { type: "account_unlinked", user: user._id, message: `${user.name} unlinked ${handle}` },
    { source: "web" },
  );
  return NextResponse.json({ ok: true });
});
