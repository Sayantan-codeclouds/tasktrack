import { connectDB } from "./db";
import { User } from "./models/User";

/** Emails that are always admin (comma-separated ADMIN_EMAILS). */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isAdminEmail = (email: string) => adminEmails().includes(email.trim().toLowerCase());

/**
 * Role for a brand-new account. With ADMIN_EMAILS set, only those emails become admin;
 * without it, the very first account does (so a fresh install can be bootstrapped).
 */
export function roleForNewUser(email: string, existingUsers: number): "admin" | "member" {
  if (adminEmails().length) return isAdminEmail(email) ? "admin" : "member";
  return existingUsers === 0 ? "admin" : "member";
}

// ---------- the admin is invisible ----------
// To everyone except the admin, the admin account does not exist: it's left out of every list,
// report and log, and its admin-only actions are logged without a name.

export async function adminUserIds(): Promise<string[]> {
  await connectDB();
  const ids = await User.find({ role: "admin" }).distinct("_id");
  return ids.map(String);
}

/** User ids this viewer must never see (the admins), or [] when the viewer is the admin. */
export async function hiddenIdsFor(viewer: { role: string }): Promise<string[]> {
  return viewer.role === "admin" ? [] : adminUserIds();
}
