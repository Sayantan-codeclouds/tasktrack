import { webhookCallback } from "grammy";
import { getBot } from "@/lib/botRuntime";

export const dynamic = "force-dynamic";

let handle: ((req: Request) => Promise<Response>) | null = null;

/** Telegram delivers every group message here (webhook mode). */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  // Only Telegram knows the secret (we give it when registering the webhook).
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("Not found", { status: 404 });
  }
  handle ??= webhookCallback(getBot(), "std/http", {
    secretToken: secret,
    // Answer Telegram quickly even if the AI is slow; the update keeps processing.
    onTimeout: "return",
    timeoutMilliseconds: 25_000,
  });
  try {
    return await handle(req);
  } catch (err) {
    // Always acknowledge: a failure response makes Telegram re-send the same update again and again,
    // which could create duplicate tickets. Log it and move on, like the polling bot does.
    console.error("[bot] webhook update failed:", err instanceof Error ? err.message : err);
    return new Response("ok", { status: 200 });
  }
}
