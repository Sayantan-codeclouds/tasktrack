import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Google OAuth 2.0 / OpenID Connect, authorization-code flow with PKCE.
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** Short-lived cookie holding the OAuth state + PKCE verifier between the two steps. */
export const OAUTH_COOKIE = "tt_oauth";

export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** Where Google sends people back. Must match an "Authorized redirect URI" in Google Cloud. */
export function redirectUri(requestUrl: string) {
  const base = process.env.APP_URL?.replace(/\/$/, "") || new URL(requestUrl).origin;
  return `${base}/api/auth/google/callback`;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function startGoogleLogin(requestUrl: string) {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(requestUrl),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), state, verifier };
}

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  picture?: string;
}

export async function finishGoogleLogin(code: string, verifier: string, requestUrl: string): Promise<GoogleProfile> {
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(requestUrl),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const tokens = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!tokenRes.ok || !tokens.access_token) {
    throw new Error(tokens.error_description || tokens.error || `Google token error ${tokenRes.status}`);
  }

  const infoRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const profile = (await infoRes.json().catch(() => ({}))) as Partial<GoogleProfile>;
  if (!infoRes.ok || !profile.sub || !profile.email) throw new Error("Couldn't read your Google profile");
  return { ...profile, email_verified: profile.email_verified === true } as GoogleProfile;
}
