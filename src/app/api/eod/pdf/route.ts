import { jsonError, withUser } from "@/lib/api";
import { buildEodPage, eodCsv, eodFileName, markEodDownloaded } from "@/lib/eod";
import { renderEodPdf } from "@/lib/eodPdf";
import { eodTargetFor } from "@/lib/eodAccess";
import { appTimeZone, dayKey, isYmd } from "@/lib/time";

export const dynamic = "force-dynamic";

/** GET /api/eod/pdf?period=day|week&date=[&user=<id>][&format=csv] → an EOD / EOW as a PDF (for HR) or CSV. */
export const GET = withUser(async (req, { user }) => {
  const q = new URL(req.url).searchParams;
  const target = await eodTargetFor(user, q.get("user"));
  if (!target) return jsonError("You can't see this person's EOD", 403);
  const period = q.get("period") === "week" ? "week" : "day";
  const date = q.get("date");
  const page = await buildEodPage(target, period, isYmd(date) ? date : dayKey(new Date(), appTimeZone()));
  if (!page) return jsonError("Not found", 404);
  const mine = target === String(user._id);

  if (q.get("format") === "csv") {
    // Your own copy is the HR one (tasks only); a Team Lead / Manager also sees attendance.
    return new Response(eodCsv([page], { attendance: !mine }), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${eodFileName(page).replace(/\.pdf$/, ".csv")}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const pdf = await renderEodPdf(page);
  // Only your own download counts as "sent to HR" (a Team Lead opening yours doesn't).
  if (mine) await markEodDownloaded(target, page.period, page.from, "web");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${eodFileName(page)}"`,
      "Cache-Control": "no-store",
    },
  });
});
