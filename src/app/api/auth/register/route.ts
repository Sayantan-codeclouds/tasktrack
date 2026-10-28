import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { isBlocked } from "@/lib/models/BlockedIdentity";
import { hashPassword, startSession } from "@/lib/auth";
import { handleError, jsonError } from "@/lib/api";
import { logActivity } from "@/lib/services";
import { isAdminEmail, roleForNewUser } from "@/lib/admin";
import { POSITIONS, POSITION_LABEL, isSelfServeRole } from "@/lib/constants";

const Body = z
  .object({
    name: z.string().trim().min(2, "Name is too short").max(60),
    email: z.email("Enter a valid email"),
    password: z.string().min(8, "Password must be at least 8 characters").max(200),
    confirmPassword: z.string().optional(),
    position: z.enum(POSITIONS, { message: "Choose your role" }).optional(),
  })
  .refine((b) => b.confirmPassword === undefined || b.confirmPassword === b.password, {
    message: "Passwords don't match",
  });

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    await connectDB();

    const count = await User.estimatedDocumentCount();
    // Listed admins can always create their account, even when registration is closed.
    if (count > 0 && process.env.ALLOW_REGISTRATION === "false" && !isAdminEmail(body.email)) {
      return jsonError("Registration is closed. Ask your manager for an account.", 403);
    }
    if (await isBlocked({ email: body.email })) {
      return jsonError("You can't create an account with this email.", 403);
    }
    if (await User.exists({ email: body.email.toLowerCase() })) {
      return jsonError("An account with this email already exists", 409);
    }

    const role = roleForNewUser(body.email, count);
    // Developer / Designer roles apply straight away; Team Lead and above wait for a manager to approve.
    const direct = body.position && (isSelfServeRole(body.position) || role === "admin");
    const user = await User.create({
      name: body.name,
      email: body.email,
      passwordHash: await hashPassword(body.password),
      role,
      position: direct ? body.position : null,
      requestedPosition: body.position && !direct ? body.position : null,
    });
    await startSession(user);
    await logActivity(
      {
        type: "login",
        user: user._id,
        message: user.position
          ? `${user.name} joined the team as ${POSITION_LABEL[user.position]}`
          : user.requestedPosition
            ? `${user.name} joined the team and asked to be ${POSITION_LABEL[user.requestedPosition]}`
            : `${user.name} joined the team`,
      },
      { source: "web" },
    );
    return NextResponse.json({ ok: true, pendingApproval: Boolean(user.requestedPosition) });
  } catch (err) {
    return handleError(err);
  }
}
