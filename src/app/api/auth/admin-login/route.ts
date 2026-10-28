import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { startSession, verifyPassword } from "@/lib/auth";
import { handleError, jsonError } from "@/lib/api";
import { isAdminEmail } from "@/lib/admin";

const Body = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

/** POST /api/auth/admin-login — the admin's own sign-in (/admin/login). Anyone else gets the same answer as a wrong password. */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    await connectDB();
    const user = await User.findOne({ email: body.email.toLowerCase() });
    const admin = user && (user.role === "admin" || isAdminEmail(user.email));
    if (!user || !admin || !user.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
      // Same message (and a short pause) whatever was wrong: it doesn't say which accounts exist or are admin.
      await new Promise((r) => setTimeout(r, 600));
      return jsonError("Wrong email or password", 401);
    }
    if (user.role !== "admin") {
      user.role = "admin";
      await user.save();
    }
    // No activity entry — the admin stays invisible to everyone else.
    await startSession(user);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
