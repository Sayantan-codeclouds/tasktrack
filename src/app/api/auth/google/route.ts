import { NextResponse } from "next/server";
import { OAUTH_COOKIE, googleEnabled, startGoogleLogin } from "@/lib/google";

/** Step 1: send the browser to Google's account chooser. */
export async function GET(req: Request) {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/login?error=google_off", req.url));
  const { url, state, verifier } = startGoogleLogin(req.url);
  const res = NextResponse.redirect(url);
  // Remember state + PKCE verifier for the callback (10 minutes, only sent to our callback path).
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, verifier }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
