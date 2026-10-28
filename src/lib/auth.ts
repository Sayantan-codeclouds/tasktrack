import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { connectDB } from "./db";
import { User } from "./models/User";

const COOKIE = "tt_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days
/** An admin signed in as someone else gets an hour, then has to start again. */
const IMPERSONATE_MAX_AGE = 60 * 60;

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error("JWT_SECRET must be set (16+ characters)");
  return new TextEncoder().encode(s);
}

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

/**
 * Sign in as `user`. With `impersonatedBy`, it's the admin viewing as that person ("imp" in the cookie):
 * a short session they can leave with "Back to admin".
 */
export async function startSession(user: { _id: unknown; sessionVersion?: number }, opts: { impersonatedBy?: string } = {}) {
  const maxAge = opts.impersonatedBy ? IMPERSONATE_MAX_AGE : MAX_AGE;
  // "v" ties the cookie to the account's sessionVersion, so bumping it signs out every old session.
  const token = await new SignJWT({ v: user.sessionVersion ?? 0, ...(opts.impersonatedBy ? { imp: opts.impersonatedBy } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user._id))
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

/** When the admin is signed in as someone else: the admin's user id. Otherwise null. */
export async function getImpersonatorId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.imp === "string" ? payload.imp : null;
  } catch {
    return null;
  }
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user (full document), or null. */
export async function getCurrentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    await connectDB();
    const user = await User.findById(payload.sub);
    // Signed out everywhere since (e.g. password reset). Cookies from before versions existed count as 0.
    if (!user || (typeof payload.v === "number" ? payload.v : 0) !== (user.sessionVersion ?? 0)) return null;
    return user;
  } catch {
    return null;
  }
}
