import { jsonError, withUser } from "@/lib/api";
import { buildTeamReport, formatReportCsv, formatReportText } from "@/lib/reports";
import { reportParams } from "@/lib/reportAccess";
import { hiddenIdsFor } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** GET /api/reports/export?team=&period=day|week&date=&format=csv|txt → file download. */
export const GET = withUser(async (req, { user }) => {
  const q = new URL(req.url).searchParams;
  const p = await reportParams(user, { team: q.get("team"), period: q.get("period"), date: q.get("date") });
  if (!p.ok) return p.error;
  const report = await buildTeamReport(p.team, p.period, p.date, { hideUserIds: await hiddenIdsFor(user) });
  if (!report) return jsonError("Team not found", 404);

  const format = q.get("format") === "txt" ? "txt" : "csv";
  const slug = report.team.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "team";
  const name = `${slug}-${report.period === "day" ? "eod" : "eow"}-${report.from}.${format}`;
  const body = format === "csv" ? formatReportCsv(report) : formatReportText(report);
  return new Response(body, {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
