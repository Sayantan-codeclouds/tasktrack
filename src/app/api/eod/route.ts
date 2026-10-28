import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, withUser } from "@/lib/api";
import { buildEodPage, EOD_LIMITS, resetEod, saveEod } from "@/lib/eod";
import { eodPeopleFor, eodTargetFor } from "@/lib/eodAccess";
import { appTimeZone, dayKey, isYmd, weekStart } from "@/lib/time";
import type { Period } from "@/lib/reports";

export const dynamic = "force-dynamic";

function params(q: URLSearchParams | { period?: string; date?: string }) {
  const get = (k: "period" | "date") => (q instanceof URLSearchParams ? q.get(k) : q[k]);
  const period: Period = get("period") === "week" ? "week" : "day";
  const date = get("date");
  const day = isYmd(date) ? date : dayKey(new Date(), appTimeZone());
  return { period, date: day, key: period === "day" ? day : weekStart(day) };
}

/**
 * GET /api/eod?period=day|week&date=YYYY-MM-DD[&user=<id>] → an EOD / EOW (saved, or the automatic draft).
 * Yours by default; Team Leads and Managers can open their people's (read-only). Also lists whose they can open.
 */
export const GET = withUser(async (req, { user }) => {
  const q = new URL(req.url).searchParams;
  const p = params(q);
  const target = await eodTargetFor(user, q.get("user"));
  if (!target) return jsonError("You can't see this person's EOD", 403);
  const [page, people] = await Promise.all([buildEodPage(target, p.period, p.date), eodPeopleFor(user)]);
  if (!page) return jsonError("Not found", 404);
  return NextResponse.json({ page, people, readOnly: target !== String(user._id) });
});

const text = (max: number) => z.string().max(max, "That's too long").transform((s) => s.trim());
const Body = z.object({
  period: z.enum(["day", "week"]),
  date: z.string(),
  content: z.object({
    login: text(EOD_LIMITS.short),
    logout: text(EOD_LIMITS.short),
    summary: text(EOD_LIMITS.text),
    tasks: z
      .array(
        z.object({
          ticket: text(EOD_LIMITS.short),
          title: text(EOD_LIMITS.title),
          status: text(EOD_LIMITS.short),
          progress: text(EOD_LIMITS.short),
          remarks: text(EOD_LIMITS.title),
        }),
      )
      .max(EOD_LIMITS.rows, "Too many task rows")
      .transform((rows) => rows.filter((r) => r.ticket || r.title || r.remarks)),
    blockers: text(EOD_LIMITS.text),
    plan: text(EOD_LIMITS.text),
  }),
});

/** PUT /api/eod — save your edited EOD / EOW. */
export const PUT = withUser(async (req, { user }) => {
  const body = Body.parse(await req.json());
  const p = params(body);
  await saveEod(String(user._id), p.period, p.key, body.content);
  return NextResponse.json({ page: await buildEodPage(String(user._id), p.period, p.date) });
});

/** DELETE /api/eod?period=&date= — throw away your edits and go back to the automatic version. */
export const DELETE = withUser(async (req, { user }) => {
  const p = params(new URL(req.url).searchParams);
  await resetEod(String(user._id), p.period, p.key);
  return NextResponse.json({ page: await buildEodPage(String(user._id), p.period, p.date) });
});
