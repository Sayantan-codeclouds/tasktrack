import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, jsonError } from "@/lib/api";
import { startSession } from "@/lib/auth";
import { resetPassword } from "@/lib/passwordReset";

const Body = z
  .object({
    token: z.string().min(20).max(200),
    password: z.string().min(8, "Password must be at least 8 characters").max(200),
    confirmPassword: z.string(),
  })
  .refine((b) => b.confirmPassword === b.password, { message: "Passwords don't match" });

/** POST /api/auth/reset — set a new password with the one-time link from the Telegram bot, then sign in. */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const user = await resetPassword(body.token, body.password);
    if (!user) return jsonError("This reset link has expired or was already used. Send /forgotpass to the bot for a new one.", 400);
    await startSession(user);
    return NextResponse.json({ ok: true, telegramLinked: Boolean(user.telegramId) });
  } catch (err) {
    return handleError(err);
  }
}
