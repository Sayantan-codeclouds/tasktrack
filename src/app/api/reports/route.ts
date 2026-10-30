import { NextResponse } from "next/server";
import { jsonError, withUser } from "@/lib/api";
import { buildTeamReport, formatReportText } from "@/lib/reports";
import { reportParams } from "@/lib/reportAccess";
import { hiddenIdsFor } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** GET /api/reports?team=<id>&period=day|week&date=YYYY-MM-DD → EOD / EOW report for a team. */
export const GET = withUser(async (req, { user }) => {
  const q = new URL(req.url).searchParams;
  const p = await reportParams(user, { team: q.get("team"), period: q.get("period"), date: q.get("date") });
  if (!p.ok) return p.error;
  const report = await buildTeamReport(p.team, p.period, p.date, { hideUserIds: await hiddenIdsFor(user) });
  if (!report) return jsonError("Team not found", 404);
  return NextResponse.json({ report, text: formatReportText(report, { attendance: false }) });
});
