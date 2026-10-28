import { jsonError, withUser } from "@/lib/api";
import { buildTeamReport, formatReportCsv, formatReportText, reportFileName } from "@/lib/reports";
import { reportParams } from "@/lib/reportAccess";
import { renderTeamReportPdf } from "@/lib/teamReportPdf";
import { hiddenIdsFor } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** GET /api/reports/export?team=&period=day|week&date=&format=pdf|csv|txt → file download. */
export const GET = withUser(async (req, { user }) => {
  const q = new URL(req.url).searchParams;
  const p = await reportParams(user, { team: q.get("team"), period: q.get("period"), date: q.get("date") });
  if (!p.ok) return p.error;
  const report = await buildTeamReport(p.team, p.period, p.date, { hideUserIds: await hiddenIdsFor(user) });
  if (!report) return jsonError("Team not found", 404);

  const format = q.get("format") === "txt" ? "txt" : q.get("format") === "pdf" ? "pdf" : "csv";
  const name = reportFileName(report, format);
  const body = format === "pdf" ? new Uint8Array(await renderTeamReportPdf(report)) : format === "csv" ? formatReportCsv(report) : formatReportText(report, { attendance: false });
  return new Response(body, {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
