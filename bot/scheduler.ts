import { InputFile, type Api } from "grammy";
import { Team } from "../src/lib/models/Team";
import { buildTeamReport, formatReportCsv, formatReportText, reportFileName, reportWorkDays } from "../src/lib/reports";
import { appTimeZone, localParts, weekStart } from "../src/lib/time";
import { isHhmm } from "../src/lib/constants";
import { adminUserIds } from "../src/lib/admin";

/** Default EOD time for teams without a shift end; EOW goes out at the same time on REPORT_EOW_DAY. */
const EOD_TIME = /^\d{2}:\d{2}$/.test(process.env.REPORT_EOD_TIME ?? "") ? process.env.REPORT_EOD_TIME! : "19:00";
/** 0 = Sunday … 6 = Saturday. Default Friday. */
const EOW_DAY = Number(process.env.REPORT_EOW_DAY ?? 5);
const WORK_DAYS = reportWorkDays();

/**
 * Called every minute. Once it's past EOD_TIME on a workday, posts each connected team's EOD
 * (and EOW on EOW_DAY) exactly once — the claim on lastEodPostedFor/lastEowPostedFor makes it safe
 * across restarts and if two bot processes ever run.
 */
export async function postScheduledReports(api: Api, now = new Date()) {
  const tz = appTimeZone();
  const { ymd, hhmm, weekday } = localParts(now, tz);
  if (!WORK_DAYS.includes(weekday)) return [];
  const posted: string[] = [];

  const teams = await Team.find({ telegramChatId: { $ne: null }, reportsEnabled: { $ne: false } })
    .select("_id name telegramChatId shiftEnd")
    .lean();
  for (const t of teams) {
    // Each team's EOD goes out when its shift ends (default REPORT_EOD_TIME).
    if (hhmm < (isHhmm(t.shiftEnd) ? t.shiftEnd : EOD_TIME)) continue;
    const jobs: { period: "day" | "week"; field: "lastEodPostedFor" | "lastEowPostedFor"; key: string }[] = [
      { period: "day", field: "lastEodPostedFor", key: ymd },
      ...(weekday === EOW_DAY ? [{ period: "week" as const, field: "lastEowPostedFor" as const, key: weekStart(ymd) }] : []),
    ];
    for (const job of jobs) {
      const claimed = await Team.updateOne({ _id: t._id, [job.field]: { $ne: job.key } }, { $set: { [job.field]: job.key } });
      if (!claimed.modifiedCount) continue;
      try {
        const report = await buildTeamReport(String(t._id), job.period, ymd, { hideUserIds: await adminUserIds() });
        if (!report) continue;
        await api.sendMessage(t.telegramChatId!, formatReportText(report));
        posted.push(`${t.name} ${job.period === "day" ? "EOD" : "EOW"}`);
        // The full report as a file anyone in the group can download. The message is already out,
        // so a failure here mustn't release the claim and post it twice.
        await api
          .sendDocument(t.telegramChatId!, new InputFile(Buffer.from(formatReportCsv(report), "utf8"), reportFileName(report, "csv")))
          .catch((err) => console.error(`[reports] failed to attach ${job.period} file for ${t.name}:`, err));
      } catch (err) {
        console.error(`[reports] failed to post ${job.period} report for ${t.name}:`, err);
        // Let the next minute retry.
        await Team.updateOne({ _id: t._id, [job.field]: job.key }, { $set: { [job.field]: null } });
      }
    }
  }
  return posted;
}

export const REPORT_SCHEDULE = { EOD_TIME, EOW_DAY, WORK_DAYS };
