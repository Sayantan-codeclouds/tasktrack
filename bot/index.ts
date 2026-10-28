import "./env";
import { connectDB } from "../src/lib/db";
import { closeForgottenDays } from "../src/lib/services";
import { SystemStatus } from "../src/lib/models/SystemStatus";
import { BOT_COMMANDS, createBot } from "./bot";
import { checkAbsences, postScheduledReports, remindMissingEods, REPORT_SCHEDULE } from "./scheduler";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

const bot = createBot(token);

async function main() {
  await connectDB();
  console.log("[bot] connected to MongoDB");

  // If the deployed website is receiving updates by webhook, polling here would silently take
  // the bot away from it (starting a poller deletes the webhook). Refuse unless told otherwise.
  const hook = await bot.api.getWebhookInfo();
  if (hook.url && process.env.BOT_FORCE_POLLING !== "1") {
    console.error(
      `[bot] Not starting: the live site is receiving this bot's messages at ${hook.url}.\n` +
        `      Use a separate test bot token for local work, or set BOT_FORCE_POLLING=1 to take over (the live site will stop getting messages until its next /api/cron run).`,
    );
    process.exit(1);
  }

  // Anyone still online from yesterday is signed off at their shift end.
  setInterval(() => {
    closeForgottenDays(REPORT_SCHEDULE.EOD_TIME)
      .then((n) => n && console.log(`[bot] ended ${n} forgotten day(s)`))
      .catch((err) => console.error("[bot] day end failed:", err));
  }, 5 * 60_000);

  // Absences, EOD on workdays and EOW at the end of the week, posted into each team's group and to Managers.
  setInterval(() => {
    checkAbsences(bot.api)
      .then((teams) => teams.length && console.log(`[reports] absence check: ${teams.join(", ")}`))
      .catch((err) => console.error("[reports] absence check failed:", err));
    postScheduledReports(bot.api)
      .then((posted) => posted.length && console.log(`[reports] posted: ${posted.join(", ")}`))
      .catch((err) => console.error("[reports] scheduler failed:", err));
    remindMissingEods(bot.api)
      .then((teams) => teams.length && console.log(`[reports] EOD reminder sent: ${teams.join(", ")}`))
      .catch((err) => console.error("[reports] EOD reminder failed:", err));
  }, 60_000);
  const s = REPORT_SCHEDULE;
  console.log(`[reports] EOD at ${s.EOD_TIME} on days ${s.WORK_DAYS.join(",")} · EOW on day ${s.EOW_DAY} (${process.env.APP_TIMEZONE || "UTC"})`);

  await bot.api.setMyCommands(BOT_COMMANDS);

  // Heartbeat for the admin page ("is the bot running?").
  const startedAt = new Date();
  const beat = () =>
    SystemStatus.updateOne(
      { _id: "bot" },
      {
        $set: {
          lastSeenAt: new Date(),
          startedAt,
          info: { username: bot.botInfo?.username ?? null, schedule: REPORT_SCHEDULE, timeZone: process.env.APP_TIMEZONE || "UTC" },
        },
      },
      { upsert: true },
    ).catch((err) => console.error("[bot] heartbeat failed:", err));
  setInterval(beat, 60_000);

  await bot.start({
    // chat_member / my_chat_member let us keep team membership in sync with each group.
    // callback_query: taps on the /menu buttons.
    allowed_updates: ["message", "chat_member", "my_chat_member", "callback_query"],
    onStart: (me) => {
      console.log(`[bot] @${me.username} is running — groups are matched to teams via /link`);
      void beat();
    },
  });
}

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
