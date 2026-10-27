import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/lib/api";
import { setPresence } from "@/lib/services";
import { PRESENCE } from "@/lib/constants";

const Body = z.object({
  presence: z.enum(PRESENCE),
  note: z.string().max(140).nullish(),
});

export const PATCH = withUser(async (req, { user }) => {
  const body = Body.parse(await req.json());
  await setPresence(user._id, body.presence, body.note ?? null, { source: "web" });
  return NextResponse.json({ ok: true });
});
