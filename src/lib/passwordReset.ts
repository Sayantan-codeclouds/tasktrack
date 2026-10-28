import { createHash, randomBytes } from "node:crypto";
import { connectDB } from "./db";
import { User } from "./models/User";
import { hashPassword } from "./auth";
import { logActivity } from "./services";

// "Forgot password" goes through the Telegram bot: being in the linked Telegram account proves who you are.
// The bot DMs a one-time link; only a hash of its token is stored.

export const RESET_TTL_MS = 30 * 60_000;
/** Don't hand out a new link more often than this. */
const RESET_COOLDOWN_MS = 60_000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A one-time password-reset link for this account, or why not. */
export async function createResetLink(userId: unknown): Promise<{ url: string } | { error: string }> {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  if (!base) return { error: "The tracker's address (APP_URL) isn't set, so I can't make a reset link." };
  await connectDB();
  const user = await User.findById(userId).select("resetTokenExpires");
  if (!user) return { error: "Your tracker account wasn't found." };
  // A link that's still fresh was just sent — wait a moment rather than flood the chat.
  if (user.resetTokenExpires && user.resetTokenExpires.getTime() - RESET_TTL_MS + RESET_COOLDOWN_MS > Date.now()) {
    return { error: "I just sent you a link — use that one, or try again in a minute." };
  }
  const token = randomBytes(32).toString("base64url");
  await User.updateOne({ _id: user._id }, { $set: { resetTokenHash: hashToken(token), resetTokenExpires: new Date(Date.now() + RESET_TTL_MS) } });
  return { url: `${base}/reset-password?token=${token}` };
}

/** Whether a reset link is still usable (for the page, before they type a password). */
export async function resetTokenValid(token: string) {
  await connectDB();
  return Boolean(await User.exists({ resetTokenHash: hashToken(token), resetTokenExpires: { $gt: new Date() } }));
}

/** Use a reset link: set the new password and sign out every existing session. Returns the user, or null if the link is bad. */
export async function resetPassword(token: string, password: string) {
  await connectDB();
  // One atomic claim, so a link can't be used twice.
  const user = await User.findOneAndUpdate(
    { resetTokenHash: hashToken(token), resetTokenExpires: { $gt: new Date() } },
    {
      $set: { passwordHash: await hashPassword(password), resetTokenHash: null, resetTokenExpires: null },
      $inc: { sessionVersion: 1 },
    },
    { returnDocument: "after" },
  );
  if (!user) return null;
  await logActivity({ type: "profile_updated", user: user._id, message: `${user.name} reset their password` }, { source: "web" });
  return user;
}
