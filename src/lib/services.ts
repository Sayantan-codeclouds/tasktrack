import { Types } from "mongoose";
import { connectDB } from "./db";
import { User } from "./models/User";
import { Task, type ITask } from "./models/Task";
import { ActivityLog } from "./models/ActivityLog";
import { nextSeq } from "./models/Counter";
import { Team } from "./models/Team";
import {
  PRESENCE_LABEL,
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  ticketKey,
  type ActivityType,
  type Presence,
  type Priority,
  type Source,
  type TaskStatus,
} from "./constants";

type Id = Types.ObjectId | string;

export interface ActivityContext {
  source: Source;
  actorId?: Id | null;
  rawText?: string | null;
  aiConfidence?: number | null;
  /** Team the action happened in, e.g. the team whose Telegram group the message came from. */
  teamId?: Id | null;
}

/** Things only someone with authority can do — when the admin does them, the log says "Admin", not who. */
const AUTHORITY_TYPES = new Set<ActivityType>([
  "role_changed",
  "user_deleted",
  "team_created",
  "team_updated",
  "team_deleted",
  "team_linked",
  "team_unlinked",
  "member_joined",
  "member_left",
  "task_deleted",
]);
const TASK_TYPES = new Set<ActivityType>(["task_created", "task_progress", "task_status", "task_completed"]);

/**
 * The admin is invisible: their admin-only actions — and edits to tickets that aren't theirs —
 * are logged without anyone named ("Ravi's role changed…", "Team POD5 created"), and with no actor.
 */
async function hideAdmin(entry: { type: ActivityType; message: string; task?: Id | null; user?: Id | null }, actorId: Id | null | undefined) {
  if (!actorId) return null;
  const actor = await User.findById(actorId).select("name role").lean();
  if (actor?.role !== "admin") return null;
  let hide = AUTHORITY_TYPES.has(entry.type) && String(entry.user ?? "") !== String(actor._id);
  if (!hide && TASK_TYPES.has(entry.type) && entry.task) {
    const t = await Task.findById(entry.task).select("assignee createdBy collaborators").lean();
    const mine = [t?.assignee, t?.createdBy, ...(t?.collaborators ?? [])].some((id) => String(id ?? "") === String(actor._id));
    hide = !mine;
  }
  if (!hide) return null;
  // Ticket messages start with the owner ("Jay: TT-1 … 0% → 60%") — drop that so it doesn't look like they did it.
  if (TASK_TYPES.has(entry.type)) return { message: entry.message.replace(/^[^“:]+: (?=TT-|“)/, "") };
  return { message: withoutActor(entry.message, actor.name) };
}

/** "Sayantan changed Ravi's role: …" → "Ravi's role changed: …"; otherwise drop the name: "Created team POD5". */
function withoutActor(message: string, name: string) {
  if (!message.startsWith(`${name} `)) return message;
  const rest = message.slice(name.length + 1);
  const role = rest.match(/^changed (.+?)'s role: (.*)$/);
  if (role) return `${role[1]}'s role changed: ${role[2]}`;
  const approved = rest.match(/^approved (.+?) as (.+)$/);
  if (approved) return `${approved[1]} approved as ${approved[2]}`;
  const declined = rest.match(/^declined (.+?)'s request to be (.+)$/);
  if (declined) return `${declined[1]}'s request to be ${declined[2]} was declined`;
  const add = rest.match(/^added (.+?) to (.+)$/);
  if (add) return `${add[1]} added to ${add[2]}`;
  const remove = rest.match(/^removed (.+?) from (.+)$/);
  if (remove) return `${remove[1]} removed from ${remove[2]}`;
  const created = rest.match(/^created team (.+)$/);
  if (created) return `Team ${created[1]} created`;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export async function logActivity(
  entry: {
    type: ActivityType;
    message: string;
    user?: Id | null;
    task?: Id | null;
    team?: Id | null;
    meta?: Record<string, unknown> | null;
  },
  ctx: ActivityContext,
) {
  await connectDB();
  const hidden = await hideAdmin(entry, ctx.actorId);
  return ActivityLog.create({
    ...entry,
    ...(hidden ? { message: hidden.message, meta: { ...(entry.meta ?? {}), byAdmin: true } } : {}),
    team: entry.team ?? ctx.teamId ?? null,
    actor: hidden ? null : (ctx.actorId ?? entry.user ?? null),
    source: ctx.source,
    rawText: ctx.rawText ?? null,
    aiConfidence: ctx.aiConfidence ?? null,
  });
}

async function nameOf(id: Id | null | undefined): Promise<string | null> {
  if (!id) return null;
  const u = await User.findById(id).select("name").lean();
  return u?.name ?? null;
}

async function namesOf(ids: (Id | null | undefined)[] | undefined): Promise<string[]> {
  const valid = (ids ?? []).filter(Boolean) as Id[];
  if (!valid.length) return [];
  const users = await User.find({ _id: { $in: valid } }).select("name").lean();
  return users.map((u) => u.name);
}

/** De-duplicated ObjectIds, without the assignee (they're already on the ticket). */
function uniqueIds(ids: Id[] | undefined, exclude?: Id | null): Types.ObjectId[] {
  const seen = new Set<string>();
  const out: Types.ObjectId[] = [];
  for (const id of ids ?? []) {
    const s = String(id);
    if (!Types.ObjectId.isValid(s) || seen.has(s) || (exclude && s === String(exclude))) continue;
    seen.add(s);
    out.push(new Types.ObjectId(s));
  }
  return out;
}

/** Change someone's presence (online / break / offline). Returns false when nothing changed. */
export async function setPresence(
  userId: Id,
  presence: Presence,
  note: string | null,
  ctx: ActivityContext,
): Promise<boolean> {
  await connectDB();
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const cleanNote = note?.trim() || null;
  if (user.presence === presence && (user.presenceNote ?? null) === cleanNote) return false;

  const previous = user.presence;
  if (previous !== presence) user.presenceSince = new Date();
  user.presence = presence;
  user.presenceNote = cleanNote;
  if (ctx.source !== "system") user.lastSeenAt = new Date();
  await user.save();

  const label = PRESENCE_LABEL[presence].toLowerCase();
  await logActivity(
    {
      type: "status_change",
      user: user._id,
      message: `${user.name} is now ${label}${cleanNote ? ` — "${cleanNote}"` : ""}`,
      meta: { from: previous, to: presence, note: cleanNote },
    },
    ctx,
  );
  return true;
}

/** `TT-12 “Fix invoice bug”` — how tasks are named in log messages. */
function ticketLabel(task: { number?: number | null; title: string }) {
  const key = ticketKey(task.number);
  return `${key ? `${key} ` : ""}“${task.title}”`;
}

/** Bring tasks created before tickets existed up to date: priority, then numbers (oldest first). */
export async function ensureTicketNumbers() {
  await connectDB();
  await Task.updateMany({ priority: { $exists: false } }, { $set: { priority: "medium" } });
  const missing = await Task.find({ number: null }).sort({ createdAt: 1 }).select("_id").lean();
  for (const t of missing) {
    await Task.updateOne({ _id: t._id, number: null }, { number: await nextSeq("task") });
  }
  return missing.length;
}

export async function createTask(
  input: {
    title: string;
    description?: string | null;
    assigneeId?: Id | null;
    createdById?: Id | null;
    dueDate?: Date | null;
    progress?: number;
    priority?: Priority | null;
    teamId?: Id | null;
    collaboratorIds?: Id[];
    telegramChatId?: string | null;
    telegramMessageId?: number | null;
  },
  ctx: ActivityContext,
) {
  await connectDB();
  await ensureTicketNumbers(); // keep numbering in creation order
  const progress = clampProgress(input.progress ?? 0);
  const task = await Task.create({
    number: await nextSeq("task"),
    team: input.teamId ?? ctx.teamId ?? null,
    collaborators: uniqueIds(input.collaboratorIds, input.assigneeId),
    priority: input.priority ?? "medium",
    title: input.title.trim(),
    description: input.description?.trim() || null,
    assignee: input.assigneeId ?? null,
    createdBy: input.createdById ?? null,
    dueDate: input.dueDate ?? null,
    progress,
    status: progress >= 100 ? "done" : progress > 0 ? "in_progress" : "todo",
    completedAt: progress >= 100 ? new Date() : null,
    source: ctx.source,
    telegramChatId: input.telegramChatId ?? null,
    telegramMessageId: input.telegramMessageId ?? null,
  });

  const [creator, assignee, helpers] = await Promise.all([
    nameOf(input.createdById),
    nameOf(input.assigneeId),
    namesOf(task.collaborators),
  ]);
  const forWhom =
    (assignee && String(input.assigneeId) !== String(input.createdById) ? ` for ${assignee}` : "") +
    (helpers.length ? ` with ${helpers.join(", ")}` : "");
  await logActivity(
    {
      type: "task_created",
      user: input.assigneeId ?? input.createdById ?? null,
      task: task._id,
      team: task.team ?? null,
      message: `${creator ?? "Someone"} created ${ticketLabel(task)}${forWhom}`,
      meta: { dueDate: task.dueDate, assignee, priority: task.priority, progress: task.progress, status: task.status },
    },
    { ...ctx, actorId: input.createdById ?? ctx.actorId },
  );
  return task;
}

export async function updateTask(
  taskId: Id,
  changes: {
    title?: string;
    description?: string | null;
    assigneeId?: Id | null;
    teamId?: Id | null;
    collaboratorIds?: Id[];
    dueDate?: Date | null;
    progress?: number | null;
    status?: TaskStatus | null;
    priority?: Priority | null;
    note?: string | null;
  },
  ctx: ActivityContext,
): Promise<{ task: ITask; changed: boolean } | null> {
  await connectDB();
  const task = await Task.findById(taskId);
  if (!task) return null;

  const before = { status: task.status, progress: task.progress };
  const logs: { type: ActivityType; message: string; meta?: Record<string, unknown> }[] = [];
  const note = changes.note?.trim() ? ` — "${changes.note.trim()}"` : "";

  if (changes.title !== undefined && changes.title.trim() && changes.title.trim() !== task.title) {
    task.title = changes.title.trim();
  }
  if (changes.description !== undefined) task.description = changes.description?.trim() || null;
  if (changes.dueDate !== undefined) task.dueDate = changes.dueDate;
  if (changes.assigneeId !== undefined && String(changes.assigneeId ?? "") !== String(task.assignee ?? "")) {
    task.assignee = changes.assigneeId ? new Types.ObjectId(String(changes.assigneeId)) : null;
    const who = await nameOf(changes.assigneeId);
    logs.push({ type: "task_status", message: `${ticketLabel(task)} reassigned to ${who ?? "nobody"}` });
  }
  if (changes.collaboratorIds !== undefined) {
    const next = uniqueIds(changes.collaboratorIds, task.assignee);
    const before = (task.collaborators ?? []).map(String);
    const added = next.filter((id) => !before.includes(String(id)));
    const removed = before.filter((id) => !next.some((n) => String(n) === id));
    if (added.length || removed.length) {
      task.collaborators = next;
      const [a, r] = await Promise.all([namesOf(added), namesOf(removed)]);
      logs.push({
        type: "task_status",
        message: `${ticketLabel(task)} ${[a.length && `now shared with ${a.join(", ")}`, r.length && `no longer with ${r.join(", ")}`].filter(Boolean).join("; ")}`,
        meta: { collaboratorsAdded: added.map(String), collaboratorsRemoved: removed },
      });
    }
  }
  // The assignee is never also listed as a collaborator.
  if (task.assignee && (task.collaborators ?? []).some((c) => String(c) === String(task.assignee))) {
    task.collaborators = task.collaborators.filter((c) => String(c) !== String(task.assignee));
  }
  if (changes.teamId !== undefined && String(changes.teamId ?? "") !== String(task.team ?? "")) {
    task.team = changes.teamId ? new Types.ObjectId(String(changes.teamId)) : null;
    const team = changes.teamId ? await Team.findById(changes.teamId).select("name").lean() : null;
    logs.push({ type: "task_status", message: `${ticketLabel(task)} moved to ${team ? `team ${team.name}` : "no team"}` });
  }
  if (changes.priority && changes.priority !== task.priority) {
    logs.push({
      type: "task_status",
      message: `${ticketLabel(task)} priority ${PRIORITY_LABEL[task.priority]} → ${PRIORITY_LABEL[changes.priority]}`,
      meta: { from: task.priority, to: changes.priority },
    });
    task.priority = changes.priority;
  }

  const progressChanged = changes.progress != null;
  let nextStatus: TaskStatus = changes.status ?? task.status;
  let nextProgress = progressChanged ? clampProgress(changes.progress!) : task.progress;

  // Keep status and progress consistent with each other.
  if (changes.status == null && progressChanged && before.status === "done" && nextProgress < 100) {
    nextStatus = "in_progress"; // progress went back down → reopen
  }
  if (before.status === "done" && changes.status && changes.status !== "done" && !progressChanged) {
    // Moved out of Done (e.g. dragged on the board) → it isn't 100% any more.
    nextProgress = changes.status === "todo" ? 0 : Math.min(nextProgress, 90);
  }
  if (nextStatus === "done" || (progressChanged && nextProgress >= 100)) {
    nextStatus = "done";
    nextProgress = 100;
  } else if (nextStatus === "todo" && nextProgress > 0 && changes.status == null) {
    nextStatus = "in_progress";
  }

  task.status = nextStatus;
  task.progress = nextProgress;
  task.completedAt = nextStatus === "done" ? (task.completedAt ?? new Date()) : null;

  const owner = (await nameOf(task.assignee)) ?? (await nameOf(ctx.actorId));
  const by = owner ? `${owner}: ` : "";

  if (nextStatus === "done" && before.status !== "done") {
    logs.push({
      type: "task_completed",
      message: `${by}completed ${ticketLabel(task)}${note}`,
      meta: { from: before, to: { status: nextStatus, progress: nextProgress } },
    });
  } else {
    if (nextStatus !== before.status) {
      logs.push({
        type: "task_status",
        message: `${by}${ticketLabel(task)} → ${TASK_STATUS_LABEL[nextStatus]}${note}`,
        meta: { from: before.status, to: nextStatus },
      });
    }
    if (nextProgress !== before.progress) {
      logs.push({
        type: "task_progress",
        message: `${by}${ticketLabel(task)} ${before.progress}% → ${nextProgress}%${nextStatus === before.status ? note : ""}`,
        meta: { from: before.progress, to: nextProgress },
      });
    }
  }

  const changed = task.isModified();
  if (!changed) return { task: task.toObject(), changed: false };
  await task.save();

  for (const l of logs) {
    await logActivity({ ...l, user: task.assignee ?? ctx.actorId ?? null, task: task._id, team: task.team ?? null }, ctx);
  }
  return { task: task.toObject(), changed: true };
}

export async function deleteTask(taskId: Id, ctx: ActivityContext) {
  await connectDB();
  const task = await Task.findByIdAndDelete(taskId);
  if (!task) return false;
  await logActivity(
    {
      type: "task_deleted",
      user: task.assignee ?? null,
      team: task.team ?? null,
      message: `${(await nameOf(ctx.actorId)) ?? "Someone"} deleted ${ticketLabel(task)}`,
    },
    ctx,
  );
  return true;
}

/** Someone's end-of-day update ("finished X, tomorrow Y"). Shown in EOD/EOW reports. */
export async function addEodNote(userId: Id, text: string, ctx: ActivityContext) {
  await connectDB();
  const clean = text.trim().slice(0, 1000);
  if (!clean) return null;
  const name = await nameOf(userId);
  return logActivity({ type: "eod_note", user: userId, message: `${name ?? "Someone"}'s EOD: ${clean}`, meta: { text: clean } }, ctx);
}

/** Mark people offline after a period of silence. Called on an interval by the bot process. */
export async function autoOfflineIdleUsers(idleMinutes: number) {
  if (idleMinutes <= 0) return 0;
  await connectDB();
  const cutoff = new Date(Date.now() - idleMinutes * 60_000);
  const idle = await User.find({
    presence: { $ne: "offline" },
    $or: [{ lastSeenAt: { $lt: cutoff } }, { lastSeenAt: null, presenceSince: { $lt: cutoff } }],
  }).select("_id");
  for (const u of idle) {
    await setPresence(u._id, "offline", `No activity for ${idleMinutes} min`, { source: "system" });
  }
  return idle.length;
}

function clampProgress(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}
