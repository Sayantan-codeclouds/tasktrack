import "server-only";
import type { Bot } from "grammy";
import { createBot } from "../../bot/bot";

/**
 * The Telegram bot running inside the website (webhook mode) — used when the site is hosted
 * somewhere without an always-on worker (e.g. Render's free plan). One instance per server process.
 */
const g = globalThis as unknown as { tasktrackBot?: Bot };

export function getBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  g.tasktrackBot ??= createBot(token);
  return g.tasktrackBot;
}

export const webhookUrl = () => {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  return base ? `${base}/api/telegram/webhook` : null;
};

/** The update types the bot needs (same as polling mode). */
// callback_query: taps on the /menu buttons.
export const ALLOWED_UPDATES = ["message", "chat_member", "my_chat_member", "callback_query"] as const;
