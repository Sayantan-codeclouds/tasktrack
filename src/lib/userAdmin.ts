import "server-only";
import { Types } from "mongoose";
import { connectDB } from "./db";
import { User, type IUser } from "./models/User";
import { Team } from "./models/Team";
import { Task } from "./models/Task";
import { BlockedIdentity } from "./models/BlockedIdentity";
import { logActivity } from "./services";
import { banFromTelegramChat } from "./telegram";

/**
 * Admin only: remove someone from TaskTrack. Their session stops working at once (it's looked up on every
 * request), their tickets stay but lose them as assignee / collaborator, and they leave every team.
 * Past activity is kept as history. With `block`, their email, Google and Telegram accounts can't come back,
 * and the bot bans them from every connected team group (needs the bot to be a group admin).
 */
export async function deleteUser(targetId: string, admin: IUser, opts: { block: boolean }) {
  await connectDB();
  const target = await User.findById(targetId).lean();
  if (!target) return { ok: false as const, error: "Person not found", status: 404 };
  if (String(target._id) === String(admin._id)) return { ok: false as const, error: "You can't delete your own account", status: 400 };

  const id = new Types.ObjectId(String(target._id));
  await Promise.all([
    Team.updateMany({ "members.user": id }, { $pull: { members: { user: id } } }),
    Team.updateMany({ lead: id }, { $set: { lead: null } }),
    Team.updateMany({ manager: id }, { $set: { manager: null } }),
    Team.updateMany({ createdBy: id }, { $set: { createdBy: null } }),
    Task.updateMany({ assignee: id }, { $set: { assignee: null } }),
    Task.updateMany({ collaborators: id }, { $pull: { collaborators: id } }),
    Task.updateMany({ createdBy: id }, { $set: { createdBy: null } }),
  ]);

  const banned: string[] = [];
  if (opts.block) {
    await BlockedIdentity.create({
      name: target.name,
      email: target.email,
      googleId: target.googleId ?? null,
      telegramId: target.telegramId ?? null,
      telegramUsername: target.telegramUsername ?? null,
    });
    if (target.telegramId) {
      await Team.updateMany({}, { $pull: { pending: { telegramId: target.telegramId } } });
      const groups = await Team.find({ telegramChatId: { $ne: null } }).select("name telegramChatId").lean();
      for (const g of groups) {
        try {
          await banFromTelegramChat(g.telegramChatId!, target.telegramId);
          banned.push(g.name);
        } catch (err) {
          console.error(`[admin] couldn't ban ${target.name} from ${g.name}'s group:`, (err as Error).message);
        }
      }
    }
  }

  await User.deleteOne({ _id: id });
  await logActivity(
    { type: "user_deleted", message: `${admin.name} removed ${target.name} from TaskTrack`, meta: { email: target.email, blocked: opts.block } },
    { source: "web", actorId: admin._id },
  );
  return { ok: true as const, name: target.name, blocked: opts.block, bannedFrom: banned };
}
