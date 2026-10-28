import { NextResponse } from "next/server";
import { jsonError, withUser } from "@/lib/api";
import { buildEodPage, eodCsv, type EodPage } from "@/lib/eod";
import { renderEveryoneEodPdf } from "@/lib/eodPdf";
import { eodPeopleFor } from "@/lib/eodAccess";
import { appTimeZone, dayKey, isYmd, weekStart, addDays } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * GET /api/eod/everyone?period=day|week&date=YYYY-MM-DD[&format=pdf|csv] — for Team Leads and Managers:
 * the EOD / EOW and current tasks of everyone they can see (not themselves). JSON by default, or a download.
 */
export const GET = withUser(async (req, { user }) => {
  const q = new URL(req.url).searchParams;
  const period = q.get("period") === "week" ? "week" : "day";
  const raw = q.get("date");
  const date = isYmd(raw) ? raw : dayKey(new Date(), appTimeZone());
  const people = (await eodPeopleFor(user)).filter((p) => !p.me);
  if (!people.length) return jsonError("Only Team Leads and Managers can see everyone's EOD", 403);

  const pages = (await Promise.all(people.map((p) => buildEodPage(p._id, period, date)))).filter((p): p is EodPage => !!p);
  const from = period === "day" ? date : weekStart(date);
  const to = period === "day" ? date : addDays(from, 6);
  const name = `everyone-${period === "day" ? "eod" : "eow"}-${from}`;

  const format = q.get("format");
  if (format === "csv") {
    return new Response(eodCsv(pages, { attendance: true }), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" },
    });
  }
  if (format === "pdf") {
    const pdf = await renderEveryoneEodPdf(pages, period, from, to, appTimeZone());
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json({ pages, positions: Object.fromEntries(people.map((p) => [p._id, p.position])) });
});
