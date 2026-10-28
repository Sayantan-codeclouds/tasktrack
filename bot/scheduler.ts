import { InputFile, type Api } from "grammy";
import { Team } from "../src/lib/models/Team";
import { User } from "../src/lib/models/User";
import { buildTeamReport, formatReportCsv, formatReportText, owesEod, reportFileName, reportWorkDays } from "../src/lib/reports";
import { ReportDownload } from "../src/lib/models/ReportDownload";
import { appTimeZone, localParts, weekStart } from "../src/lib/time";
import { isHhmm } from "../src/lib/constants";
import { adminUserIds } from "../src/lib/admin";

/** Default EOD time for teams without a shift end; EOW goes out at the same time on REPORT_EOW_DAY. */
const EOD_TIME = /^\d{2}:\d{2}$/.test(process.env.REPORT_EOD_TIME ?? "") ? process.env.REPORT_EOD_TIME! : "19:00";
/** 0 = Sunday … 6 = Saturday. Default Friday. */
const EOW_DAY = Number(process.env.REPORT_EOW_DAY ?? 5);
const WORK_DAYS = reportWorkDays();
/** How long before the EOD to remind people who haven't done theirs. 0 turns it off. */
const EOD_REMINDER_MINUTES = Number(process.env.REPORT_EOD_REMINDER_MINUTES ?? 30);

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

/** "20:06" − 30 → "19:36" (not before midnight). */
function minus(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.max(0, h * 60 + m - minutes);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Called every minute. In the EOD_REMINDER_MINUTES before a team's EOD goes out, pings the people who were
 * online today but haven't downloaded today's EOD PDF (and, on EOW_DAY, the week's EOW) to upload to the HR
 * portal. Anyone not online today is skipped. Once a day per team, and only if someone's still to do it.
 */
export async function remindMissingEods(api: Api, now = new Date()) {
  const tz = appTimeZone();
  const { ymd, hhmm, weekday } = localParts(now, tz);
  if (!WORK_DAYS.includes(weekday) || EOD_REMINDER_MINUTES <= 0) return [];
  const reminded: string[] = [];

  const teams = await Team.find({ telegramChatId: { $ne: null }, reportsEnabled: { $ne: false } })
    .select("_id name telegramChatId shiftEnd")
    .lean();
  for (const t of teams) {
    const eodAt = isHhmm(t.shiftEnd) ? t.shiftEnd : EOD_TIME;
    // Only between the reminder time and the EOD itself — a late wake-up skips straight to the EOD.
    if (hhmm < minus(eodAt, EOD_REMINDER_MINUTES) || hhmm >= eodAt) continue;
    const claimed = await Team.updateOne({ _id: t._id, lastEodReminderFor: { $ne: ymd } }, { $set: { lastEodReminderFor: ymd } });
    if (!claimed.modifiedCount) continue;
    try {
      const report = await buildTeamReport(String(t._id), "day", ymd, { hideUserIds: await adminUserIds() });
      if (!report) continue;
      const due = report.members.filter((m) => owesEod(m, ymd)).map((m) => m._id);
      const isEowDay = weekday === EOW_DAY;
      const downloads = await ReportDownload.find({
        user: { $in: due },
        $or: [{ period: "day" as const, key: ymd }, ...(isEowDay ? [{ period: "week" as const, key: weekStart(ymd) }] : [])],
      })
        .select("user period")
        .lean();
      const has = (period: "day" | "week") => new Set(downloads.filter((d) => d.period === period).map((d) => String(d.user)));
      const eodLeft = due.filter((id) => !has("day").has(id));
      const eowLeft = isEowDay ? due.filter((id) => !has("week").has(id)) : [];
      if (!eodLeft.length && !eowLeft.length) continue;

      const people = new Map(
        (await User.find({ _id: { $in: [...new Set([...eodLeft, ...eowLeft])] } }).select("name telegramId").lean()).map((p) => [String(p._id), p]),
      );
      // A mention by Telegram id pings people even without a @username.
      const mention = (id: string) => {
        const p = people.get(id);
        if (!p) return "";
        return p.telegramId ? `<a href="tg://user?id=${p.telegramId}">${escapeHtml(p.name)}</a>` : escapeHtml(p.name);
      };
      const list = (ids: string[]) => ids.map(mention).filter(Boolean).join(", ");
      const site = process.env.APP_URL?.replace(/\/$/, "");
      await api.sendMessage(
        t.telegramChatId!,
        [
          `⏰ <b>EOD reminder</b> — ${EOD_REMINDER_MINUTES} min to go (team EOD at ${eodAt}).`,
          `Download your ${isEowDay ? "EOD and EOW" : "EOD"} PDF and upload it to the HR portal.`,
          "",
          ...(eodLeft.length ? [`📄 EOD not downloaded yet: ${list(eodLeft)}`] : []),
          ...(eowLeft.length ? [`📄 EOW not downloaded yet: ${list(eowLeft)}`] : []),
          "",
          `${site ? `Get it at ${escapeHtml(site)}/eod — or s` : "S"}end /myeod${isEowDay ? " (and /myeod week)" : ""} and I'll send it to you privately.`,
        ].join("\n"),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      );
      reminded.push(t.name);
    } catch (err) {
      console.error(`[reports] failed to send the EOD reminder for ${t.name}:`, err);
      await Team.updateOne({ _id: t._id, lastEodReminderFor: ymd }, { $set: { lastEodReminderFor: null } });
    }
  }
  return reminded;
}

export const REPORT_SCHEDULE = { EOD_TIME, EOW_DAY, WORK_DAYS, EOD_REMINDER_MINUTES };
