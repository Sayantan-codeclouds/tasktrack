import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { logActivity } from "@/lib/services";
import { LINK_CODE_TTL_MS, newLinkCode } from "@/lib/linkCode";

/** Create a one-time code the user sends to the bot as `/link CODE`. */
export const POST = withUser(async (_req, { user }) => {
  user.linkCode = await newLinkCode();
  user.linkCodeExpires = new Date(Date.now() + LINK_CODE_TTL_MS);
  await user.save();
  return NextResponse.json({ code: user.linkCode, expires: user.linkCodeExpires });
});

export const DELETE = withUser(async (_req, { user }) => {
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
