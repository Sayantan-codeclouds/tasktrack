import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { SystemStatus } from "@/lib/models/SystemStatus";
import { autoOfflineIdleUsers } from "@/lib/services";
import { ALLOWED_UPDATES, getBot, webhookUrl } from "@/lib/botRuntime";
import { BOT_COMMANDS } from "../../../../bot/bot";
import { postScheduledReports, REPORT_SCHEDULE } from "../../../../bot/scheduler";

export const dynamic = "force-dynamic";

const startedAt = new Date();

/**
 * GET /api/cron?key=<CRON_SECRET> — call every 1–5 minutes from an external scheduler (e.g. cron-job.org).
 * Keeps the webhook registered, posts due EOD/EOW reports, marks idle people offline, and records a
 * heartbeat. Calling it regularly also stops a free Render instance from going to sleep.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const given = url.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || given !== secret) return new Response("Not found", { status: 404 });

  await connectDB();
  const bot = getBot();
  const result: Record<string, unknown> = {};

  // 1. Make sure Telegram is sending updates to this site.
  const target = webhookUrl();
  if (target && process.env.TELEGRAM_WEBHOOK_SECRET) {
    try {
      const info = await bot.api.getWebhookInfo();
      if (info.url !== target) {
        await bot.api.setWebhook(target, {
          secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: [...ALLOWED_UPDATES],
        });
        await bot.api.setMyCommands(BOT_COMMANDS);
        result.webhook = "registered";
      } else {
        result.webhook = info.last_error_message ? `ok (last error: ${info.last_error_message})` : "ok";
      }
    } catch (err) {
      result.webhook = `error: ${(err as Error).message}`;
    }
  } else {
    result.webhook = "skipped (set APP_URL and TELEGRAM_WEBHOOK_SECRET)";
  }

  // 2. Reports and auto-offline.
  try {
    result.reportsPosted = await postScheduledReports(bot.api);
  } catch (err) {
    result.reports = `error: ${(err as Error).message}`;
  }
  const idleMinutes = Number(process.env.AUTO_OFFLINE_MINUTES ?? 240);
  try {
    result.markedOffline = await autoOfflineIdleUsers(idleMinutes);
  } catch (err) {
    result.autoOffline = `error: ${(err as Error).message}`;
  }

  // 3. Heartbeat for the private overview page.
  await SystemStatus.updateOne(
    { _id: "bot" },
    {
      $set: {
        lastSeenAt: new Date(),
        startedAt,
        info: { username: process.env.TELEGRAM_BOT_USERNAME ?? null, mode: "webhook", schedule: REPORT_SCHEDULE, timeZone: process.env.APP_TIMEZONE || "UTC" },
      },
    },
    { upsert: true },
  );

  return NextResponse.json({ ok: true, at: new Date().toISOString(), ...result });
}
