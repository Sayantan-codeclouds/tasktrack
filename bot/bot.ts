import { Bot, InputFile, type Context } from "grammy";
import type { ChatMember, UserFromGetMe } from "grammy/types";
import type { Types } from "mongoose";
import { User, type IUser } from "../src/lib/models/User";
import { isBlocked } from "../src/lib/models/BlockedIdentity";
import { Task } from "../src/lib/models/Task";
import { Team, type ITeam } from "../src/lib/models/Team";
import { POSITION_LABEL, TASK_STATUS_LABEL, ticketKey, type Presence, type Priority } from "../src/lib/constants";
import { addEodNote, createTask, logActivity, setPresence, updateTask, type ActivityContext } from "../src/lib/services";
import { buildTeamReport, formatReportText } from "../src/lib/reports";
import { buildEodPage, eodFileName } from "../src/lib/eod";
import { renderEodPdf } from "../src/lib/eodPdf";
import { adminUserIds } from "../src/lib/admin";
import { appTimeZone, dayKey } from "../src/lib/time";
import {
  addMember,
  addPending,
  claimPendingMemberships,
  linkTeamChat,
  migrateChatId,
  removeMember,
  removePending,
  teamForChat,
  teamIdsForUser,
  unlinkTeamChat,
  type TelegramPerson,
} from "../src/lib/teams";
import { interpretMessage } from "./ai";

const MIN_CONFIDENCE = Number(process.env.AI_MIN_CONFIDENCE ?? 0.6);
const TIME_ZONE = process.env.APP_TIMEZONE || "UTC";

type TeamDoc = ITeam;
type UserDoc = IUser & { save(): Promise<unknown> };

// ---------- helpers ----------

/** Private chats always work; groups only once they're connected to a team. */
async function scopeOf(ctx: Context): Promise<{ ok: boolean; team: TeamDoc | null }> {
  const chat = ctx.chat;
  if (!chat) return { ok: false, team: null };
  if (chat.type === "private") return { ok: true, team: null };
  const team = await teamForChat(chat.id);
  return { ok: Boolean(team), team };
}

/**
 * The team this message counts for: the group's team, or — in a private chat — the sender's team
 * when they're in exactly one, so DM'd EOD notes and tickets still reach that team's EOD / EOW.
 */
async function teamIdFor(scope: { team: TeamDoc | null }, userId: Types.ObjectId) {
  if (scope.team) return scope.team._id;
  const ids = await teamIdsForUser(userId);
  return ids.length === 1 ? ids[0] : null;
}

const notConnectedWarned = new Set<number>();
async function warnNotConnected(ctx: Context) {
  if (!ctx.chat || notConnectedWarned.has(ctx.chat.id)) return;
  notConnectedWarned.add(ctx.chat.id);
  await ctx.reply(
    "This group isn't connected to a team yet.\n" +
      "A Manager can connect it: open the Team page in the tracker → your team → “Connect Telegram group”, then send /link CODE here.",
  );
}

async function findSender(ctx: Context) {
  if (!ctx.from) return null;
  return User.findOne({ telegramId: String(ctx.from.id) });
}

/** Keep the stored @username fresh and record that the person was active. */
async function touch(user: UserDoc, ctx: Context) {
  user.lastSeenAt = new Date();
  const username = ctx.from?.username ?? null;
  if (username !== (user.telegramUsername ?? null)) user.telegramUsername = username;
  await user.save();
}

/** Someone talking in a team's group belongs to that team (covers people who were there before the bot). */
async function ensureMember(team: TeamDoc | null, user: UserDoc) {
  if (!team || team.members.some((m) => String(m.user) === String(user._id))) return;
  await addMember(team._id, user._id, "telegram", { source: "telegram", teamId: team._id }, "active in the Telegram group");
}

async function openTasksFor(userId: Types.ObjectId) {
  return Task.find({ $or: [{ assignee: userId }, { collaborators: userId }], status: { $ne: "done" } })
    .sort({ createdAt: 1 })
    .lean();
}

function formatDue(d?: Date | null) {
  return d
    ? new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    : null;
}

async function react(ctx: Context, emoji: "👍" | "🤔" | "✍") {
  try {
    await ctx.react(emoji);
  } catch {
    // Reactions can be disabled in a chat; that's fine.
  }
}

/** "TT-12 Fix invoice bug" for bot replies. */
const ticket = (t: { number?: number | null; title: string }) =>
  t.number ? `${ticketKey(t.number)} ${t.title}` : t.title;

const PRIORITY_MARK: Partial<Record<Priority, string>> = { urgent: " 🔴 Urgent", high: " 🟠 High" };

const notLinkedWarned = new Set<number>();
async function warnNotLinked(ctx: Context) {
  if (!ctx.from || notLinkedWarned.has(ctx.from.id)) return;
  notLinkedWarned.add(ctx.from.id);
  await ctx.reply(
    `👋 ${ctx.from.first_name}, your Telegram isn't linked to the tracker yet.\n` +
      `Open your Profile page in the tracker, click "Link Telegram", then send me /link CODE.`,
    ctx.msg ? { reply_parameters: { message_id: ctx.msg.message_id } } : undefined,
  );
}

/** Parses "/cmd rest of text" → "rest of text" (handles /cmd@BotName). */
const argsOf = (ctx: Context) => (typeof ctx.match === "string" ? ctx.match.trim() : "");

const isIn = (m: ChatMember) =>
  m.status === "member" || m.status === "administrator" || m.status === "creator" || (m.status === "restricted" && m.is_member);

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- membership sync ----------

async function handleJoin(ctx: Context, team: TeamDoc, person: TelegramPerson, greet: boolean) {
  const user = await User.findOne({ telegramId: String(person.id) });
  if (user) {
    const added = await addMember(team._id, user._id, "telegram", { source: "telegram", teamId: team._id }, "added to the Telegram group");
    if (added && greet) await ctx.reply(`👋 Welcome ${user.name}! You're now in ${team.name} on the tracker.`);
  } else if (!(await isBlocked({ telegramId: String(person.id) }))) {
    await addPending(team._id, person);
    if (greet) {
      await ctx.reply(
        `👋 Welcome ${person.first_name}! To appear in ${team.name} on the tracker:\n` +
          `1. Sign up on the tracker website\n2. Profile → “Link Telegram”\n3. Send /link CODE here or to me privately`,
      );
    }
  }
}

async function handleLeave(team: TeamDoc, person: TelegramPerson, how: string) {
  const user = await User.findOne({ telegramId: String(person.id) }).select("_id").lean();
  if (user) await removeMember(team._id, user._id, { source: "telegram", teamId: team._id }, how);
  await removePending(team._id, person.id);
}

// ---------- the bot ----------

const HELP = `I track your team's status and tickets from this chat.

Just talk normally — I'll understand things like:
• "Good morning, starting now" → Online
• "Lunch, back in 30" → On break
• "Login page is about 70% done" → Progress
• "@ravi please build the payment API by Friday" → New ticket for Ravi
• "Finished the dashboard, logging off" → Done + Offline

Teams: each team has its own group. Add people to the group and they join the team on the tracker.

Commands (if you want to be exact):
/online [note] · /break [note] · /offline [note]
/tasks — your open tickets
/progress <#> <percent> [note] — e.g. /progress 2 80
/done <#> — mark a ticket done
/new <title> — create a ticket for yourself
/eod <text> — your end-of-day update (or just start a message with "EOD:")
/report · /report week — this team's EOD / EOW summary
/myeod · /myeod week — your own EOD / EOW as a PDF, sent to you privately (edit it on the website's EOD / EOW page)
/link <CODE> — link your account, or connect this group to a team
/chatid — show this chat's id`;

export function createBot(token: string, options?: { botInfo?: UserFromGetMe }) {
  const bot = new Bot(token, options?.botInfo ? { botInfo: options.botInfo } : undefined);

  bot.command(["start", "help"], (ctx) => ctx.reply(HELP));
  bot.command("chatid", (ctx) => ctx.reply(`This chat's id is ${ctx.chat.id}`));

  // One command for both: a person's code links their account, a team's code connects this group.
  bot.command("link", async (ctx) => {
    const code = argsOf(ctx).toUpperCase();
    if (!code) return ctx.reply("Send /link CODE — get the code from the tracker (Profile page, or Team page for a group).");
    const isGroup = ctx.chat.type !== "private";
    const removeCode = () => (isGroup ? ctx.deleteMessage().catch(() => {}) : undefined);

    // 1) A person's code
    const user = await User.findOne({ linkCode: code, linkCodeExpires: { $gt: new Date() } });
    if (user) {
      const telegramId = String(ctx.from!.id);
      if (await isBlocked({ telegramId })) return removeCode();
      const existing = await User.findOne({ telegramId, _id: { $ne: user._id } });
      if (existing) {
        existing.telegramId = null;
        existing.telegramUsername = null;
        await existing.save();
      }
      user.telegramId = telegramId;
      user.telegramUsername = ctx.from!.username ?? null;
      user.linkCode = null;
      user.linkCodeExpires = null;
      await user.save();
      notLinkedWarned.delete(ctx.from!.id);

      const team = isGroup ? await teamForChat(ctx.chat.id) : null;
      await logActivity(
        {
          type: "account_linked",
          user: user._id,
          message: `${user.name} linked Telegram${user.telegramUsername ? ` @${user.telegramUsername}` : ""}`,
        },
        { source: "telegram", teamId: team?._id },
      );
      // Join every team group they were already waiting in, plus this one.
      const joined = await claimPendingMemberships(user._id, telegramId);
      if (team && (await addMember(team._id, user._id, "telegram", { source: "telegram", teamId: team._id }, "linked their account"))) {
        joined.push(team.name);
      }
      const teams = [...new Set(joined)];
      await ctx.reply(
        `✅ Linked! Hi ${user.name} — your updates will now show on the tracker.` +
          (teams.length ? `\nYou're in: ${teams.join(", ")}` : ""),
      );
      await removeCode();
      return;
    }

    // 2) A team's code → connect this group
    if (!isGroup) {
      if (await Team.exists({ linkCode: code, linkCodeExpires: { $gt: new Date() } })) {
        return ctx.reply("That's a team code — send it inside the team's Telegram group, not here.");
      }
      return ctx.reply("❌ That code is invalid or expired. Generate a new one in the tracker.");
    }
    const sender = await findSender(ctx);
    const result = await linkTeamChat(code, { id: ctx.chat.id, title: "title" in ctx.chat ? ctx.chat.title : undefined }, {
      source: "telegram",
      actorId: sender?._id ?? null,
    });
    if (!result) return ctx.reply("❌ That code is invalid or expired. Generate a new one in the tracker.");
    if ("error" in result) return ctx.reply(`❌ ${result.error}`);

    notConnectedWarned.delete(ctx.chat.id);
    if (sender) await addMember(result.team._id, sender._id, "telegram", { source: "telegram", teamId: result.team._id }, "connected the group");
    await ctx.reply(
      `✅ This group is now connected to team ${result.team.name}.\n\n` +
        `• Add people to this group and they join ${result.team.name} on the tracker; remove them and they leave.\n` +
        `• People already here are added the first time they send a message.\n` +
        `• Everyone needs to link their own account once: Profile → “Link Telegram” → send /link CODE here.`,
    );
    await removeCode();
  });

  function presenceCommand(presence: Presence) {
    return async (ctx: Context) => {
      const scope = await scopeOf(ctx);
      if (!scope.ok) return warnNotConnected(ctx);
      const user = await findSender(ctx);
      if (!user) return warnNotLinked(ctx);
      await touch(user, ctx);
      await ensureMember(scope.team, user);
      await setPresence(user._id, presence, argsOf(ctx) || null, {
        source: "telegram",
        rawText: ctx.msg?.text ?? null,
        teamId: scope.team?._id,
      });
      await react(ctx, "👍");
    };
  }
  bot.command("online", presenceCommand("online"));
  bot.command("break", presenceCommand("break"));
  bot.command("offline", presenceCommand("offline"));

  bot.command("tasks", async (ctx) => {
    const scope = await scopeOf(ctx);
    if (!scope.ok) return warnNotConnected(ctx);
    const user = await findSender(ctx);
    if (!user) return warnNotLinked(ctx);
    const tasks = await openTasksFor(user._id);
    if (!tasks.length) return ctx.reply(`${user.name}, you have no open tickets 🎉`);
    const lines = tasks.map((t, i) => {
      const due = formatDue(t.dueDate);
      return `${i + 1}. ${ticket(t)} — ${TASK_STATUS_LABEL[t.status]}, ${t.progress}%${due ? ` (due ${due})` : ""}`;
    });
    await ctx.reply(`${user.name}'s open tickets:\n${lines.join("\n")}`);
  });

  async function taskByIndex(ctx: Context, userId: Types.ObjectId, raw: string | undefined) {
    const n = Number(raw);
    const tasks = await openTasksFor(userId);
    if (!Number.isInteger(n) || n < 1 || n > tasks.length) {
      await ctx.reply("Ticket number not found — use /tasks to see the numbers.");
      return null;
    }
    return tasks[n - 1];
  }

  bot.command("progress", async (ctx) => {
    const scope = await scopeOf(ctx);
    if (!scope.ok) return warnNotConnected(ctx);
    const user = await findSender(ctx);
    if (!user) return warnNotLinked(ctx);
    await touch(user, ctx);
    await ensureMember(scope.team, user);
    const [idx, pct, ...note] = argsOf(ctx).split(/\s+/);
    const percent = Number(String(pct ?? "").replace("%", ""));
    if (!Number.isFinite(percent)) return ctx.reply("Usage: /progress <ticket #> <percent> [note]");
    const task = await taskByIndex(ctx, user._id, idx);
    if (!task) return;
    await updateTask(
      task._id,
      { progress: percent, note: note.join(" ") || null },
      { source: "telegram", actorId: user._id, rawText: ctx.msg?.text ?? null, teamId: scope.team?._id },
    );
    await react(ctx, "👍");
  });

  bot.command("done", async (ctx) => {
    const scope = await scopeOf(ctx);
    if (!scope.ok) return warnNotConnected(ctx);
    const user = await findSender(ctx);
    if (!user) return warnNotLinked(ctx);
    await touch(user, ctx);
    await ensureMember(scope.team, user);
    const [idx] = argsOf(ctx).split(/\s+/);
    const task = await taskByIndex(ctx, user._id, idx);
    if (!task) return;
    await updateTask(
      task._id,
      { status: "done" },
      { source: "telegram", actorId: user._id, rawText: ctx.msg?.text ?? null, teamId: scope.team?._id },
    );
    await ctx.reply(`✅ Done: ${ticket(task)}`);
  });

  bot.command("new", async (ctx) => {
    const scope = await scopeOf(ctx);
    if (!scope.ok) return warnNotConnected(ctx);
    const user = await findSender(ctx);
    if (!user) return warnNotLinked(ctx);
    await touch(user, ctx);
    await ensureMember(scope.team, user);
    const title = argsOf(ctx);
    if (title.length < 2) return ctx.reply("Usage: /new <ticket title>");
    const task = await createTask(
      {
        title,
        assigneeId: user._id,
        createdById: user._id,
        teamId: await teamIdFor(scope, user._id),
        telegramChatId: String(ctx.chat.id),
        telegramMessageId: ctx.msg.message_id,
      },
      { source: "telegram", actorId: user._id, rawText: ctx.msg.text },
    );
    const sent = await ctx.reply(`🆕 ${ticket(task)} → ${user.name}`);
    await Task.updateOne({ _id: task._id }, { telegramBotMessageId: sent.message_id });
  });

  // ---------- EOD notes & reports ----------

  bot.command("eod", async (ctx) => {
    const scope = await scopeOf(ctx);
    if (!scope.ok) return warnNotConnected(ctx);
    const user = await findSender(ctx);
    if (!user) return warnNotLinked(ctx);
    const text = argsOf(ctx);
    if (text.length < 2) return ctx.reply("Usage: /eod what you did today, and what's next\ne.g. /eod Finished TT-12 login, started TT-15 payments. Tomorrow: tests.");
    await touch(user, ctx);
    await ensureMember(scope.team, user);
    await addEodNote(user._id, text, { source: "telegram", rawText: ctx.msg?.text ?? null, teamId: await teamIdFor(scope, user._id) });
    await react(ctx, "✍");
  });

  // /report → today's EOD for this group's team · /report week → this week's EOW
  bot.command("report", async (ctx) => {
    const scope = await scopeOf(ctx);
    if (!scope.team) {
      return scope.ok ? ctx.reply("Send /report inside a team's group.") : warnNotConnected(ctx);
    }
    const period = /^w/i.test(argsOf(ctx)) ? "week" : "day";
    const report = await buildTeamReport(String(scope.team._id), period, dayKey(new Date(), appTimeZone()), {
      hideUserIds: await adminUserIds(),
    });
    if (report) await ctx.reply(formatReportText(report));
  });

  // /myeod → your EOD as a PDF, sent to you privately, ready to forward to HR · /myeod week → your EOW
  bot.command("myeod", async (ctx) => {
    const user = await findSender(ctx);
    if (!user) return warnNotLinked(ctx);
    const period = /^w/i.test(argsOf(ctx)) ? "week" : "day";
    const page = await buildEodPage(String(user._id), period, dayKey(new Date(), appTimeZone()));
    if (!page) return;
    const pdf = await renderEodPdf(page);
    const kind = period === "day" ? "EOD" : "EOW";
    const caption = `${kind} — ${user.name}${page.saved ? "" : " (automatic; edit it on the EOD / EOW page)"}`;
    // Always to the person privately — never into the group.
    try {
      await ctx.api.sendDocument(ctx.from!.id, new InputFile(pdf, eodFileName(page)), { caption });
    } catch {
      // Telegram won't let a bot message someone who hasn't started a chat with it.
      if (ctx.chat?.type === "private") return;
      await ctx.reply(`📩 ${user.name}, I can't message you privately yet — open https://t.me/${ctx.me.username}?start=eod, tap Start, then send /myeod again.`, {
        ...(ctx.msg ? { reply_parameters: { message_id: ctx.msg.message_id } } : {}),
        link_preview_options: { is_disabled: true },
      });
      return;
    }
    if (ctx.chat?.type !== "private") await react(ctx, "👍");
  });

  // ---------- group membership → team membership ----------

  bot.on("message:new_chat_members", async (ctx) => {
    const team = await teamForChat(ctx.chat.id);
    if (!team) return;
    for (const person of ctx.msg.new_chat_members) {
      if (!person.is_bot) await handleJoin(ctx, team, person, true);
    }
  });

  bot.on("message:left_chat_member", async (ctx) => {
    const person = ctx.msg.left_chat_member;
    if (person.is_bot) return;
    const team = await teamForChat(ctx.chat.id);
    if (team) await handleLeave(team, person, "left the Telegram group");
  });

  // Delivered when the bot is an admin — also catches joins/leaves whose service message is hidden.
  bot.on("chat_member", async (ctx) => {
    const { old_chat_member: before, new_chat_member: after } = ctx.chatMember;
    if (after.user.is_bot) return;
    const team = await teamForChat(ctx.chat.id);
    if (!team) return;
    if (!isIn(before) && isIn(after)) await handleJoin(ctx, team, after.user, false);
    else if (isIn(before) && !isIn(after)) {
      await handleLeave(team, after.user, after.status === "kicked" ? "removed from the Telegram group" : "left the Telegram group");
    }
  });

  // The bot itself was added to / removed from a group.
  bot.on("my_chat_member", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const { old_chat_member: before, new_chat_member: after } = ctx.myChatMember;
    if (!isIn(before) && isIn(after)) {
      const team = await teamForChat(ctx.chat.id);
      await ctx.reply(
        team
          ? `👋 Hi again! This group is connected to team ${team.name}.`
          : "👋 Hi! I'm the TaskTrack bot.\n\nTo connect this group to a team, a Manager opens the Team page in the tracker → the team → “Connect Telegram group”, then sends /link CODE here.\n\nTip: make me an admin so I can tidy up /link codes and see everyone who joins.",
      );
    } else if (isIn(before) && !isIn(after)) {
      const team = await teamForChat(ctx.chat.id);
      if (team) await unlinkTeamChat(team._id, { source: "telegram" }, "the bot was removed from the group");
    }
  });

  // A group upgraded to a supergroup gets a new id.
  bot.on("message:migrate_to_chat_id", async (ctx) => {
    await migrateChatId(ctx.chat.id, ctx.msg.migrate_to_chat_id);
  });

  // ---------- free text → AI ----------

  bot.on("message:text", async (ctx) => {
    const text = ctx.msg.text.trim();
    if (text.startsWith("/") || text.length < 2) return;
    if (ctx.from.is_bot) return;
    const scope = await scopeOf(ctx);
    if (!scope.ok) return; // unconnected group: stay quiet
    const team = scope.team;

    const user = await findSender(ctx);
    if (!user) return warnNotLinked(ctx);
    await touch(user, ctx);
    await ensureMember(team, user);

    // In a team's group, the AI only assigns work within that team.
    const memberIds = team
      ? (await Team.findById(team._id).select("members.user").lean())?.members.map((m) => m.user) ?? []
      : null;
    const [ownTasks, assignedByMe, members] = await Promise.all([
      openTasksFor(user._id),
      Task.find({ createdBy: user._id, assignee: { $ne: user._id }, status: { $ne: "done" } })
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean(),
      User.find(memberIds ? { _id: { $in: memberIds } } : {})
        .select("name telegramUsername position")
        .sort({ name: 1 })
        .lean(),
    ]);

    const reply = ctx.msg.reply_to_message;
    let replyTask = null;
    if (reply) {
      replyTask = await Task.findOne({
        telegramChatId: String(ctx.chat.id),
        $or: [{ telegramMessageId: reply.message_id }, { telegramBotMessageId: reply.message_id }],
      }).lean();
    }

    const taskPool = [...ownTasks, ...assignedByMe];
    if (replyTask && !taskPool.some((t) => String(t._id) === String(replyTask._id))) taskPool.push(replyTask);
    const nameById = new Map(members.map((m) => [String(m._id), m.name]));

    const taskRefs = taskPool.slice(0, 30).map((t, i) => ({ ref: `T${i + 1}`, task: t }));
    const memberRefs = members.map((m, i) => ({ ref: `M${i + 1}`, member: m }));

    let result;
    try {
      result = await interpretMessage({
        text,
        sender: { name: user.name, presence: user.presence, presenceNote: user.presenceNote },
        tasks: taskRefs.map(({ ref, task }) => ({
          ref,
          key: ticketKey(task.number),
          title: task.title,
          status: task.status,
          progress: task.progress,
          assignee: task.assignee ? (nameById.get(String(task.assignee)) ?? null) : null,
        })),
        members: memberRefs.map(({ ref, member }) => ({
          ref,
          name: member.name,
          username: member.telegramUsername ?? null,
          role: member.position ? POSITION_LABEL[member.position] : null,
        })),
        replyToTaskRef: replyTask ? taskRefs.find((r) => String(r.task._id) === String(replyTask._id))?.ref : null,
        replyToText: reply && "text" in reply ? (reply.text ?? null) : null,
        now: new Date(),
        timeZone: TIME_ZONE,
      });
    } catch (err) {
      console.error("[ai] interpret failed:", err);
      return;
    }

    console.log(
      `[ai] ${team ? `[${team.name}] ` : ""}${user.name}: "${text.slice(0, 80)}" → ${JSON.stringify(result.actions)} (conf ${result.confidence}) ${result.reason}`,
    );
    if (!result.actions.length) return;
    if (result.confidence < MIN_CONFIDENCE) {
      await react(ctx, "🤔");
      return;
    }

    const teamId = await teamIdFor(scope, user._id);
    const actx: ActivityContext = {
      source: "telegram",
      actorId: user._id,
      rawText: text,
      aiConfidence: result.confidence,
      teamId,
    };
    const replies: string[] = [];
    let applied = 0;

    for (const action of result.actions) {
      try {
        if (action.type === "set_status") {
          if (await setPresence(user._id, action.status, action.note ?? null, actx)) applied++;
        } else if (action.type === "eod_note") {
          if (await addEodNote(user._id, action.text, actx)) {
            applied++;
            await react(ctx, "✍");
          }
        } else if (action.type === "update_task") {
          const target = taskRefs.find((r) => r.ref === action.task)?.task;
          if (!target) continue;
          const res = await updateTask(
            target._id,
            { progress: action.progress ?? null, status: action.status ?? null, note: action.note ?? null },
            actx,
          );
          if (res?.changed) {
            applied++;
            if (res.task.status === "done" && target.status !== "done") replies.push(`✅ Done: ${ticket(res.task)}`);
            else if (res.task.status === "blocked" && target.status !== "blocked")
              replies.push(`⛔ Blocked: ${ticket(res.task)}${action.note ? ` — ${action.note}` : ""}`);
          }
        } else if (action.type === "create_task") {
          const assignee = action.assignee ? memberRefs.find((r) => r.ref === action.assignee)?.member : null;
          const assigneeId = assignee?._id ?? user._id;
          const duplicate = await Task.exists({
            assignee: assigneeId,
            status: { $ne: "done" },
            title: { $regex: `^${escapeRegex(action.title.trim())}$`, $options: "i" },
          });
          if (duplicate) continue;
          const task = await createTask(
            {
              title: action.title,
              description: action.description,
              assigneeId,
              createdById: user._id,
              teamId,
              collaboratorIds: (action.collaborators ?? [])
                .map((ref) => memberRefs.find((r) => r.ref === ref)?.member._id)
                .filter((id): id is NonNullable<typeof id> => Boolean(id)),
              dueDate: action.dueDate ? new Date(action.dueDate) : null,
              progress: action.progress ?? 0,
              priority: action.priority ?? null,
              telegramChatId: String(ctx.chat.id),
              telegramMessageId: ctx.msg.message_id,
            },
            actx,
          );
          applied++;
          const due = formatDue(task.dueDate);
          const helpers = (action.collaborators ?? [])
            .map((ref) => memberRefs.find((r) => r.ref === ref)?.member.name)
            .filter((n) => n && n !== (assignee?.name ?? user.name));
          const who = (assignee ? assignee.name : user.name) + (helpers.length ? ` + ${helpers.join(", ")}` : "");
          const sent = await ctx.reply(
            `🆕 ${ticket(task)} → ${who}${due ? ` (due ${due})` : ""}${PRIORITY_MARK[task.priority] ?? ""}`,
            { reply_parameters: { message_id: ctx.msg.message_id } },
          );
          await Task.updateOne({ _id: task._id }, { telegramBotMessageId: sent.message_id });
        }
      } catch (err) {
        console.error("[bot] failed to apply action", action, err);
      }
    }

    // EOD notes already got ✍ — only add 👍 when something else changed too.
    if (applied && !result.actions.every((a) => a.type === "eod_note")) await react(ctx, "👍");
    if (replies.length) {
      await ctx.reply(replies.join("\n"), { reply_parameters: { message_id: ctx.msg.message_id } });
    }
  });

  bot.catch((err) => console.error("[bot] error:", err.error));
  return bot;
}

export const BOT_COMMANDS = [
  { command: "online", description: "Set yourself online" },
  { command: "break", description: "Go on a break" },
  { command: "offline", description: "Go offline" },
  { command: "tasks", description: "List your open tickets" },
  { command: "progress", description: "Update progress: /progress 2 80" },
  { command: "done", description: "Mark a ticket done: /done 2" },
  { command: "new", description: "Create a ticket for yourself" },
  { command: "eod", description: "Post your end-of-day update" },
  { command: "report", description: "Team EOD report (/report week for EOW)" },
  { command: "myeod", description: "Your EOD as a PDF (/myeod week for EOW)" },
  { command: "link", description: "Link your account or connect this group" },
  { command: "help", description: "How to use the bot" },
];
