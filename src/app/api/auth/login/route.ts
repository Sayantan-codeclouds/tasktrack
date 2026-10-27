import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { startSession, verifyPassword } from "@/lib/auth";
import { handleError, jsonError } from "@/lib/api";
import { logActivity } from "@/lib/services";
import { isAdminEmail } from "@/lib/admin";

const Body = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    await connectDB();
    const user = await User.findOne({ email: body.email.toLowerCase() });
    if (user && !user.passwordHash) {
      return jsonError("This account uses Google sign-in — click “Continue with Google”", 401);
    }
    if (!user || !(await verifyPassword(body.password, user.passwordHash!))) {
      return jsonError("Wrong email or password", 401);
    }
    // Keep listed admins admin (e.g. ADMIN_EMAILS was set after they signed up).
    if (user.role !== "admin" && isAdminEmail(user.email)) {
      user.role = "admin";
      await user.save();
    }
    await startSession(String(user._id));
    await logActivity(
      { type: "login", user: user._id, message: `${user.name} signed in to the tracker` },
      { source: "web" },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
