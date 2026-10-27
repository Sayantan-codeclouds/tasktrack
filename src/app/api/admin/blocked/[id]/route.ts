import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { jsonError, withUser } from "@/lib/api";
import { BlockedIdentity } from "@/lib/models/BlockedIdentity";
import { unbanFromTelegramChat } from "@/lib/telegram";
import { Team } from "@/lib/models/Team";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/admin/blocked/<id> — admin only: lift a block so they can sign up / join the groups again. */
export const DELETE = withUser<Ctx>(async (_req, { params, user }) => {
  if (user.role !== "admin") return jsonError("Not found", 404);
  const { id } = await params;
  if (!isValidObjectId(id)) return jsonError("Not found", 404);
  const entry = await BlockedIdentity.findByIdAndDelete(id).lean();
  if (!entry) return jsonError("Not found", 404);
  if (entry.telegramId) {
    const groups = await Team.find({ telegramChatId: { $ne: null } }).select("telegramChatId").lean();
    for (const g of groups) await unbanFromTelegramChat(g.telegramChatId!, entry.telegramId).catch(() => {});
  }
  return NextResponse.json({ ok: true });
});
