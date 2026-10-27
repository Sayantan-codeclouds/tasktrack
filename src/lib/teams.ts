import { Types } from "mongoose";
import { connectDB } from "./db";
import { Team, type ITeam } from "./models/Team";
import { Task } from "./models/Task";
import { User } from "./models/User";
import { logActivity, type ActivityContext } from "./services";
import { TEAM_COLORS } from "./constants";

type Id = Types.ObjectId | string;

async function nameOf(id: Id | null | undefined) {
  if (!id) return null;
  return (await User.findById(id).select("name").lean())?.name ?? null;
}

export async function teamForChat(chatId: string | number) {
  await connectDB();
  return Team.findOne({ telegramChatId: String(chatId) }).lean();
}

/** Ids of the teams someone belongs to, leads or oversees. */
export async function teamIdsForUser(userId: Id): Promise<string[]> {
  await connectDB();
  const ids = await Team.find({ $or: [{ "members.user": userId }, { lead: userId }, { manager: userId }] }).distinct("_id");
  return ids.map(String);
}

export async function createTeam(
  input: { name: string; description?: string | null; leadId?: Id | null; managerId?: Id | null },
  ctx: ActivityContext,
) {
  await connectDB();
  const count = await Team.estimatedDocumentCount();
  const team = await Team.create({
    name: input.name.trim(),
    description: input.description?.trim() || null,
    color: TEAM_COLORS[count % TEAM_COLORS.length],
    createdBy: ctx.actorId ?? null,
    lead: input.leadId ?? null,
    manager: input.managerId ?? null,
  });
  const [creator, lead, manager] = await Promise.all([nameOf(ctx.actorId), nameOf(input.leadId), nameOf(input.managerId)]);
  const who = [lead && `lead ${lead}`, manager && `overseen by ${manager}`].filter(Boolean).join(", ");
  await logActivity(
    { type: "team_created", team: team._id, message: `${creator ?? "Someone"} created team ${team.name}${who ? ` (${who})` : ""}` },
    ctx,
  );
  // The lead and manager are part of the team.
  for (const id of [input.leadId, input.managerId]) if (id) await addMember(team._id, id, "web", ctx);
  return team;
}

export async function updateTeam(
  id: Id,
  input: {
    name?: string;
    description?: string | null;
    leadId?: Id | null;
    managerId?: Id | null;
    shiftStart?: string | null;
    shiftEnd?: string | null;
  },
  ctx: ActivityContext,
) {
  await connectDB();
  const team = await Team.findById(id);
  if (!team) return null;
  const actor = (await nameOf(ctx.actorId)) ?? "Someone";
  const notes: string[] = [];
  const before = team.name;
  if (input.name?.trim() && input.name.trim() !== team.name) {
    team.name = input.name.trim();
    notes.push(`renamed team ${before} → ${team.name}`);
  }
  if (input.description !== undefined && (input.description?.trim() || null) !== (team.description ?? null)) {
    team.description = input.description?.trim() || null;
    notes.push(`updated ${team.name}'s description`);
  }
  const join: Id[] = [];
  if (input.leadId !== undefined && String(input.leadId ?? "") !== String(team.lead ?? "")) {
    team.lead = input.leadId ? new Types.ObjectId(String(input.leadId)) : null;
    notes.push(input.leadId ? `made ${await nameOf(input.leadId)} Team Lead of ${team.name}` : `removed ${team.name}'s Team Lead`);
    if (input.leadId) join.push(input.leadId);
  }
  if (input.managerId !== undefined && String(input.managerId ?? "") !== String(team.manager ?? "")) {
    team.manager = input.managerId ? new Types.ObjectId(String(input.managerId)) : null;
    notes.push(input.managerId ? `assigned ${await nameOf(input.managerId)} to oversee ${team.name}` : `removed ${team.name}'s overseeing Manager`);
    if (input.managerId) join.push(input.managerId);
  }
  const start = input.shiftStart !== undefined ? input.shiftStart : team.shiftStart;
  const end = input.shiftEnd !== undefined ? input.shiftEnd : team.shiftEnd;
  if ((start ?? null) !== (team.shiftStart ?? null) || (end ?? null) !== (team.shiftEnd ?? null)) {
    team.shiftStart = start ?? null;
    team.shiftEnd = end ?? null;
    notes.push(start && end ? `set ${team.name}'s shift to ${start}–${end}` : `cleared ${team.name}'s shift timings`);
  }
  if (!team.isModified()) return team;
  await team.save();
  for (const note of notes) await logActivity({ type: "team_updated", team: team._id, message: `${actor} ${note}` }, ctx);
  for (const uid of join) await addMember(team._id, uid, "web", ctx);
  return team;
}

/** Deletes the team. Its tickets stay, without a team. */
export async function deleteTeam(id: Id, ctx: ActivityContext) {
  await connectDB();
  const team = await Team.findByIdAndDelete(id);
  if (!team) return false;
  const { modifiedCount } = await Task.updateMany({ team: team._id }, { $set: { team: null } });
  await logActivity(
    {
      type: "team_deleted",
      message: `${(await nameOf(ctx.actorId)) ?? "Someone"} deleted team ${team.name}${modifiedCount ? ` (${modifiedCount} ticket${modifiedCount === 1 ? "" : "s"} kept without a team)` : ""}`,
      meta: { teamName: team.name },
    },
    ctx,
  );
  return true;
}

/** Adds someone to a team. Returns false if they were already in it. */
export async function addMember(teamId: Id, userId: Id, via: "telegram" | "web", ctx: ActivityContext, how?: string) {
  await connectDB();
  const user = await User.findById(userId).select("name telegramId role").lean();
  // The admin is invisible, so never appears as a team member.
  if (!user || user.role === "admin") return false;
  const res = await Team.updateOne(
    { _id: teamId, "members.user": { $ne: user._id } },
    {
      $push: { members: { user: user._id, addedAt: new Date(), via } },
      ...(user.telegramId ? { $pull: { pending: { telegramId: user.telegramId } } } : {}),
    },
  );
  if (!res.modifiedCount) return false;
  const team = await Team.findById(teamId).select("name").lean();
  const actor = ctx.actorId && String(ctx.actorId) !== String(user._id) ? await nameOf(ctx.actorId) : null;
  await logActivity(
    {
      type: "member_joined",
      user: user._id,
      team: teamId,
      message: actor
        ? `${actor} added ${user.name} to ${team?.name}`
        : `${user.name} joined ${team?.name}${how ? ` — ${how}` : ""}`,
    },
    { ...ctx, actorId: ctx.actorId ?? user._id },
  );
  return true;
}

/** Removes someone from a team. Returns false if they weren't in it. */
export async function removeMember(teamId: Id, userId: Id, ctx: ActivityContext, how?: string) {
  await connectDB();
  const res = await Team.updateOne({ _id: teamId }, { $pull: { members: { user: new Types.ObjectId(String(userId)) } } });
  if (!res.modifiedCount) return false;
  const [team, name] = await Promise.all([Team.findById(teamId).select("name").lean(), nameOf(userId)]);
  const actor = ctx.actorId && String(ctx.actorId) !== String(userId) ? await nameOf(ctx.actorId) : null;
  await logActivity(
    {
      type: "member_left",
      user: userId,
      team: teamId,
      message: actor ? `${actor} removed ${name} from ${team?.name}` : `${name} left ${team?.name}${how ? ` — ${how}` : ""}`,
    },
    { ...ctx, actorId: ctx.actorId ?? userId },
  );
  return true;
}

export interface TelegramPerson {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
}

/** Remember a group member who hasn't linked their tracker account yet. */
export async function addPending(teamId: Id, p: TelegramPerson) {
  await connectDB();
  await Team.updateOne(
    { _id: teamId, "pending.telegramId": { $ne: String(p.id) } },
    {
      $push: {
        pending: {
          telegramId: String(p.id),
          username: p.username ?? null,
          name: [p.first_name, p.last_name].filter(Boolean).join(" "),
          joinedAt: new Date(),
        },
      },
    },
  );
}

export async function removePending(teamId: Id, telegramId: string | number) {
  await connectDB();
  await Team.updateOne({ _id: teamId }, { $pull: { pending: { telegramId: String(telegramId) } } });
}

/** After someone links Telegram: join every team whose group they were already waiting in. */
export async function claimPendingMemberships(userId: Id, telegramId: string) {
  await connectDB();
  const teams = await Team.find({ "pending.telegramId": telegramId }).select("_id name").lean();
  const joined: string[] = [];
  for (const t of teams) {
    if (await addMember(t._id, userId, "telegram", { source: "telegram" }, "linked their account")) joined.push(t.name);
    await removePending(t._id, telegramId);
  }
  return joined;
}

/** `/link CODE` sent in a group with a team's code → that group becomes the team's group. */
export async function linkTeamChat(
  code: string,
  chat: { id: number | string; title?: string },
  ctx: ActivityContext,
): Promise<{ team: ITeam } | { error: string } | null> {
  await connectDB();
  const team = await Team.findOne({ linkCode: code, linkCodeExpires: { $gt: new Date() } });
  if (!team) return null;

  const chatId = String(chat.id);
  const other = await Team.findOne({ telegramChatId: chatId, _id: { $ne: team._id } }).select("name").lean();
  if (other) return { error: `This group is already connected to team ${other.name}. Disconnect it there first.` };

  team.telegramChatId = chatId;
  team.telegramChatTitle = chat.title ?? null;
  team.telegramLinkedAt = new Date();
  team.linkCode = null;
  team.linkCodeExpires = null;
  await team.save();
  await logActivity(
    {
      type: "team_linked",
      team: team._id,
      message: `Telegram group “${chat.title ?? chatId}” connected to team ${team.name}`,
    },
    ctx,
  );
  return { team: team.toObject() };
}

export async function unlinkTeamChat(teamId: Id, ctx: ActivityContext, why?: string) {
  await connectDB();
  const team = await Team.findById(teamId);
  if (!team?.telegramChatId) return false;
  const title = team.telegramChatTitle ?? team.telegramChatId;
  team.telegramChatId = null;
  team.telegramChatTitle = null;
  team.telegramLinkedAt = null;
  team.pending = [];
  await team.save();
  await logActivity(
    { type: "team_unlinked", team: team._id, message: `Telegram group “${title}” disconnected from team ${team.name}${why ? ` — ${why}` : ""}` },
    ctx,
  );
  return true;
}

/** Telegram gives a group a new id when it's upgraded to a supergroup. */
export async function migrateChatId(fromId: number | string, toId: number | string) {
  await connectDB();
  await Team.updateOne({ telegramChatId: String(fromId) }, { $set: { telegramChatId: String(toId) } });
  await Task.updateMany({ telegramChatId: String(fromId) }, { $set: { telegramChatId: String(toId) } });
}
