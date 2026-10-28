import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser, getImpersonatorId } from "./auth";
import { User, type IUser } from "./models/User";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type Handler<C> = (
  req: Request,
  ctx: C & { user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>> },
) => Promise<Response>;

/** Wraps a route handler: requires a signed-in user and turns thrown errors into JSON. */
export function withUser<C = unknown>(handler: Handler<C>) {
  return async (req: Request, ctx: C) => {
    try {
      const user = await getCurrentUser();
      if (!user) return jsonError("Not signed in", 401);
      await markSeen(req, user);
      return await handler(req, { ...ctx, user });
    } catch (err) {
      return handleError(err);
    }
  };
}

/**
 * Doing something on the site (not just having a page open, which polls with GET) counts as activity,
 * so people working only on the website aren't marked offline for silence.
 */
async function markSeen(req: Request, user: Pick<IUser, "_id" | "lastSeenAt">) {
  if (req.method === "GET" || (user.lastSeenAt && Date.now() - user.lastSeenAt.getTime() < 60_000)) return;
  // The admin looking around as someone doesn't make that person "active".
  if (await getImpersonatorId()) return;
  await User.updateOne({ _id: user._id }, { $set: { lastSeenAt: new Date() } });
}

export function handleError(err: unknown) {
  if (err instanceof ZodError) {
    return jsonError(err.issues[0]?.message ?? "Invalid input", 400);
  }
  console.error(err);
  return jsonError("Something went wrong", 500);
}
