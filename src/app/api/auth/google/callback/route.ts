import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { isBlocked } from "@/lib/models/BlockedIdentity";
import { startSession } from "@/lib/auth";
import { OAUTH_COOKIE, finishGoogleLogin, googleEnabled } from "@/lib/google";
import { logActivity } from "@/lib/services";
import { isAdminEmail, roleForNewUser } from "@/lib/admin";

/** Step 2: Google sends the person back here with a one-time code. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });
    return res;
  };
  if (!googleEnabled()) return fail("google_off");
  if (url.searchParams.get("error")) return fail("google_cancelled"); // e.g. they closed the chooser

  const jar = await cookies();
  let saved: { state?: string; verifier?: string } = {};
  try {
    saved = JSON.parse(jar.get(OAUTH_COOKIE)?.value ?? "{}");
  } catch {
    // fall through to the state check
  }
  const code = url.searchParams.get("code");
  if (!code || !saved.state || !saved.verifier || url.searchParams.get("state") !== saved.state) return fail("google_state");

  let profile;
  try {
    profile = await finishGoogleLogin(code, saved.verifier, req.url);
  } catch (err) {
    console.error("[google] sign-in failed:", err);
    return fail("google_failed");
  }
  if (!profile.email_verified) return fail("google_unverified");

  await connectDB();
  const email = profile.email.toLowerCase();
  if (await isBlocked({ email, googleId: profile.sub })) return fail("blocked");
  let user = await User.findOne({ googleId: profile.sub });
  let isNew = false;

  if (!user) {
    // Same verified email as an existing account → link Google to it.
    user = await User.findOne({ email });
    if (user) {
      user.googleId = profile.sub;
      await user.save();
    } else {
      const count = await User.estimatedDocumentCount();
      if (count > 0 && process.env.ALLOW_REGISTRATION === "false" && !isAdminEmail(email)) return fail("registration_closed");
      user = await User.create({
        name: profile.name?.trim() || email.split("@")[0],
        email,
        passwordHash: null,
        googleId: profile.sub,
        role: roleForNewUser(email, count),
      });
      isNew = true;
    }
  }

  await startSession(user);
  await logActivity(
    {
      type: "login",
      user: user._id,
      message: isNew ? `${user.name} joined the team (Google)` : `${user.name} signed in with Google`,
    },
    { source: "web" },
  );

  // Not on Telegram yet → Profile, which walks them through linking it.
  const res = NextResponse.redirect(new URL(user.telegramId ? "/tracker" : "/profile?connect=telegram", req.url));
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });
  return res;
}
