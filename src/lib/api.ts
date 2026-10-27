import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser } from "./auth";

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
      return await handler(req, { ...ctx, user });
    } catch (err) {
      return handleError(err);
    }
  };
}

export function handleError(err: unknown) {
  if (err instanceof ZodError) {
    return jsonError(err.issues[0]?.message ?? "Invalid input", 400);
  }
  console.error(err);
  return jsonError("Something went wrong", 500);
}
