import { InputFile, InputMediaBuilder, type Api } from "grammy";
import { Team } from "../src/lib/models/Team";
import { User } from "../src/lib/models/User";
import {
  ABSENT_AFTER_MIN,
  buildTeamReport,
  formatReportCsv,
  formatReportText,
  owesEod,
  reportFileName,
  reportWorkDays,
  wasAround,
  type TeamReport,
} from "../src/lib/reports";
import { ReportDownload } from "../src/lib/models/ReportDownload";
import { appTimeZone, localParts, weekStart } from "../src/lib/time";
import { POSITIONS, POSITION_GROUP, POSITION_RANK, isHhmm } from "../src/lib/constants";
import { renderTeamReportPdf } from "../src/lib/teamReportPdf";
import { buildEodPage, eodFileName } from "../src/lib/eod";
import { renderEodPdf } from "../src/lib/eodPdf";
import { adminUserIds } from "../src/lib/admin";
import { overseenTeamIds } from "../src/lib/oversight";

/** Default EOD time for teams without a shift end; EOW goes out at the same time on REPORT_EOW_DAY. */
const EOD_TIME = /^\d{2}:\d{2}$/.test(process.env.REPORT_EOD_TIME ?? "") ? process.env.REPORT_EOD_TIME! : "19:00";
/** 0 = Sunday … 6 = Saturday. Default Friday. */
const EOW_DAY = Number(process.env.REPORT_EOW_DAY ?? 5);
const WORK_DAYS = reportWorkDays();
/** How long before the EOD to remind people who haven't done theirs. 0 turns it off. */
const EOD_REMINDER_MINUTES = Number(process.env.REPORT_EOD_REMINDER_MINUTES ?? 30);

/**
 * Team Leads and above (not the admin) with Telegram linked, and the teams each one oversees (null = all).
 * Each gets the EOD / EOW of their own teams privately.
 */
async function overseersOnTelegram() {
  const people = await User.find({
    role: { $ne: "admin" },
    position: { $in: POSITIONS.filter((p) => POSITION_RANK[p] >= POSITION_RANK.team_lead) },
    telegramId: { $ne: null },
  })
    .select("name telegramId role position")
    .lean();
  return Promise.all(people.map(async (p) => ({ name: p.name, telegramId: p.telegramId!, teamIds: await overseenTeamIds(p) })));
}

/** A team's EOD / EOW for a Manager or Team Lead: the summary, the team PDF, and each person's own EOD PDF. */
export interface TeamPack {
  text: string;
  teamPdf: { data: Buffer; name: string };
  people: { name: string; data: Buffer; file: string; saved: boolean }[];
}

/** Build it once, send it to as many people as needed. Only people who were around get an EOD (not anyone on leave). */
export async function buildTeamPack(report: TeamReport, date: string): Promise<TeamPack> {
  const people: TeamPack["people"] = [];
  const due = report.members.filter(
    (m) => m.inTeam && !(m.position && POSITION_GROUP[m.position] === "management") && report.days.some((d) => wasAround(m, d)),
  );
  for (const m of due) {
    const page = await buildEodPage(m._id, report.period, date);
    if (page) people.push({ name: m.name, data: await renderEodPdf(page), file: eodFileName(page), saved: page.saved });
  }
  return { text: formatReportText(report), teamPdf: { data: await renderTeamReportPdf(report), name: reportFileName(report, "pdf") }, people };
}

/** Send a TeamPack to one private chat. The people's PDFs go in albums of up to 10. */
export async function sendTeamPack(api: Api, chatId: number | string, pack: TeamPack, kind: "EOD" | "EOW") {
  await api.sendMessage(chatId, pack.text);
  await api.sendDocument(chatId, new InputFile(pack.teamPdf.data, pack.teamPdf.name));
  for (let i = 0; i < pack.people.length; i += 10) {
    const batch = pack.people.slice(i, i + 10);
    const caption = (p: TeamPack["people"][number]) => `${kind} — ${p.name}${p.saved ? "" : " (automatic, not edited)"}`;
    // An album needs at least two files.
    if (batch.length === 1) await api.sendDocument(chatId, new InputFile(batch[0].data, batch[0].file), { caption: caption(batch[0]) });
    else await api.sendMediaGroup(chatId, batch.map((p) => InputMediaBuilder.document(new InputFile(p.data, p.file), { caption: caption(p) })));
  }
}

/**
 * Called every minute. Once it's past a team's EOD time on a workday, posts its EOD (and EOW on EOW_DAY)
 * exactly once — into the team's group if it has one, and privately to its Manager(s) and Team Lead — the claim on
 * lastEodPostedFor/lastEowPostedFor makes it safe across restarts and if two bot processes ever run.
 */
export async function postScheduledReports(api: Api, now = new Date()) {
  const tz = appTimeZone();
  const { ymd, hhmm, weekday } = localParts(now, tz);
  if (!WORK_DAYS.includes(weekday)) return [];
  const posted: string[] = [];

  // Every team — the private copies go out for teams without a Telegram group too.
  const teams = await Team.find({ reportsEnabled: { $ne: false } })
    .select("_id name telegramChatId shiftEnd")
    .lean();
  let overseers: Awaited<ReturnType<typeof overseersOnTelegram>> | null = null;
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
        const text = formatReportText(report, { attendance: false });
        if (t.telegramChatId) {
          await api.sendMessage(t.telegramChatId, text);
          // The full report as a file anyone in the group can download. The message is already out,
          // so a failure here mustn't release the claim and post it twice.
          await api
            .sendDocument(t.telegramChatId, new InputFile(Buffer.from(formatReportCsv(report), "utf8"), reportFileName(report, "csv")))
            .catch((err) => console.error(`[reports] failed to attach ${job.period} file for ${t.name}:`, err));
        }
        posted.push(`${t.name} ${job.period === "day" ? "EOD" : "EOW"}`);

        // The team's Manager(s) and Team Lead get it privately: the team PDF and each person's EOD PDF.
        // One failing (e.g. never started the bot) doesn't stop the rest.
        overseers ??= await overseersOnTelegram();
        const to = overseers.filter((o) => !o.teamIds || o.teamIds.includes(String(t._id)));
        if (to.length) {
          const pack = await buildTeamPack(report, ymd);
          for (const m of to) {
            try {
              await sendTeamPack(api, m.telegramId!, pack, job.period === "day" ? "EOD" : "EOW");
            } catch (err) {
              console.error(`[reports] couldn't send ${t.name}'s ${job.period} report to ${m.name}:`, (err as Error).message);
            }
          }
        }
      } catch (err) {
        console.error(`[reports] failed to post ${job.period} report for ${t.name}:`, err);
        // Let the next minute retry.
        await Team.updateOne({ _id: t._id, [job.field]: job.key }, { $set: { [job.field]: null } });
      }
    }
  }
  return posted;
}

/** "20:06" − 30 → "19:36" (kept within the day). */
function minus(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m - minutes));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Called every minute. ABSENT_AFTER_MIN after a team's shift starts, tells its Team Lead and Manager(s)
 * privately who hasn't come online today — they're absent. Once a day per team, and only if someone is.
 */
export async function checkAbsences(api: Api, now = new Date()) {
  const tz = appTimeZone();
  const { ymd, hhmm, weekday } = localParts(now, tz);
  if (!WORK_DAYS.includes(weekday) || ABSENT_AFTER_MIN <= 0) return [];
  const checked: string[] = [];

  const teams = await Team.find({ reportsEnabled: { $ne: false }, shiftStart: { $ne: null } })
    .select("_id name lead shiftStart shiftEnd")
    .lean();
  let overseers: Awaited<ReturnType<typeof overseersOnTelegram>> | null = null;
  for (const t of teams) {
    if (!isHhmm(t.shiftStart)) continue;
    const checkAt = minus(t.shiftStart, -ABSENT_AFTER_MIN);
    // Between the check time and the EOD — waking up after the EOD skips it.
    if (hhmm < checkAt || hhmm >= (isHhmm(t.shiftEnd) ? t.shiftEnd : EOD_TIME)) continue;
    const claimed = await Team.updateOne({ _id: t._id, lastAbsenceCheckFor: { $ne: ymd } }, { $set: { lastAbsenceCheckFor: ymd } });
    if (!claimed.modifiedCount) continue;
    try {
      const report = await buildTeamReport(String(t._id), "day", ymd, { hideUserIds: await adminUserIds() });
      // Absent, and still not online now.
      const absent = report?.members.filter((m) => m.days[ymd]?.absent && !m.days[ymd]?.firstOnline) ?? [];
      checked.push(`${t.name}: ${absent.length} absent`);
      if (!absent.length) continue;

      // The team's Manager(s) and its Team Lead.
      overseers ??= await overseersOnTelegram();
      const lead = t.lead ? await User.findById(t.lead).select("name telegramId").lean() : null;
      const mine = overseers.filter((o) => !o.teamIds || o.teamIds.includes(String(t._id)));
      const to = new Map([...mine, ...(lead?.telegramId ? [lead] : [])].map((p) => [p.telegramId!, p.name]));
      const text = `🚫 Absent today — ${t.name}\nNot online by ${checkAt} (shift started ${t.shiftStart}):\n${absent.map((m) => `• ${m.name}`).join("\n")}`;
      for (const [chatId, name] of to) {
        await api.sendMessage(chatId, text).catch((err) => console.error(`[reports] couldn't send ${t.name}'s absences to ${name}:`, (err as Error).message));
      }
    } catch (err) {
      console.error(`[reports] absence check failed for ${t.name}:`, err);
      await Team.updateOne({ _id: t._id, lastAbsenceCheckFor: ymd }, { $set: { lastAbsenceCheckFor: null } });
    }
  }
  return checked;
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

export const REPORT_SCHEDULE = { EOD_TIME, EOW_DAY, WORK_DAYS, EOD_REMINDER_MINUTES, ABSENT_AFTER_MIN };
