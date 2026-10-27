import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, withUser } from "@/lib/api";
import { Team } from "@/lib/models/Team";
import { buildTeamReport, formatReportCsv, formatReportText, reportFileName } from "@/lib/reports";
import { reportParams } from "@/lib/reportAccess";
import { sendTelegramDocument, sendTelegramMessage } from "@/lib/telegram";
import { adminUserIds } from "@/lib/admin";

const Body = z.object({ team: z.string(), period: z.enum(["day", "week"]), date: z.string().optional() });

/** Post the report to the team's Telegram group now. */
export const POST = withUser(async (req, { user }) => {
  const body = Body.parse(await req.json());
  const p = await reportParams(user, body);
  if (!p.ok) return p.error;
  const team = await Team.findById(p.team).select("telegramChatId").lean();
  if (!team?.telegramChatId) return jsonError("This team's Telegram group isn't connected", 400);
  // Everyone in the group reads this, so the admin is always left out — and never named as the poster.
  const report = await buildTeamReport(p.team, p.period, p.date, { hideUserIds: await adminUserIds() });
  if (!report) return jsonError("Team not found", 404);
  try {
    await sendTelegramMessage(team.telegramChatId, user.role === "admin" ? formatReportText(report) : `${formatReportText(report)}\n\n— posted by ${user.name}`);
  } catch (err) {
    return jsonError(`Telegram: ${(err as Error).message}`, 502);
  }
  // The message is out; the downloadable file is a bonus.
  await sendTelegramDocument(team.telegramChatId, reportFileName(report, "csv"), formatReportCsv(report)).catch((err) =>
    console.error("[reports] failed to attach report file:", err),
  );
  return NextResponse.json({ ok: true });
});
