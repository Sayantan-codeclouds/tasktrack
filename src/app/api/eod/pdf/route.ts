import { jsonError, withUser } from "@/lib/api";
import { buildEodPage, eodFileName } from "@/lib/eod";
import { renderEodPdf } from "@/lib/eodPdf";
import { appTimeZone, dayKey, isYmd } from "@/lib/time";

export const dynamic = "force-dynamic";

/** GET /api/eod/pdf?period=day|week&date= → your EOD / EOW as a PDF, ready to email to HR. */
export const GET = withUser(async (req, { user }) => {
  const q = new URL(req.url).searchParams;
  const period = q.get("period") === "week" ? "week" : "day";
  const date = q.get("date");
  const page = await buildEodPage(String(user._id), period, isYmd(date) ? date : dayKey(new Date(), appTimeZone()));
  if (!page) return jsonError("Not found", 404);
  const pdf = await renderEodPdf(page);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${eodFileName(page)}"`,
      "Cache-Control": "no-store",
    },
  });
});
