import "server-only";

/** Send a plain-text message to a chat from the web app (the bot process uses grammY instead). */
export async function sendTelegramMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!data.ok) throw new Error(data.description ?? `Telegram error ${res.status}`);
}

/** Send a text file (e.g. a report CSV) to a chat as a downloadable document. */
export async function sendTelegramDocument(chatId: string, fileName: string, content: string, caption?: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("document", new Blob([content], { type: "text/csv" }), fileName);
  if (caption) form.set("caption", caption);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!data.ok) throw new Error(data.description ?? `Telegram error ${res.status}`);
}

async function call(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!data.ok) throw new Error(data.description ?? `Telegram error ${res.status}`);
}

/** Remove someone from a group and stop them rejoining. The bot must be an admin there. */
export const banFromTelegramChat = (chatId: string, telegramId: string) =>
  call("banChatMember", { chat_id: chatId, user_id: Number(telegramId), revoke_messages: false });

/** Let them join again (doesn't add them back). */
export const unbanFromTelegramChat = (chatId: string, telegramId: string) =>
  call("unbanChatMember", { chat_id: chatId, user_id: Number(telegramId), only_if_banned: true });
