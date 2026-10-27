import { Types, isValidObjectId, type QueryFilter } from "mongoose";
import type { IActivityLog } from "./models/ActivityLog";
import { ACTIVITY_TYPES, SOURCES, type ActivityType, type Source } from "./constants";

/**
 * Builds the activity-log filter from query params shared by /api/logs and /api/logs/export:
 * user, task, type, source, from (ISO), to (ISO), q (text search). `before` is the paging cursor.
 */
export function buildLogFilter(
  q: URLSearchParams,
  { withCursor = true, hideUserIds = [] as string[] } = {},
): QueryFilter<IActivityLog> {
  const and: QueryFilter<IActivityLog>[] = [];

  // Nothing by or about hidden accounts (the admin) for anyone else.
  if (hideUserIds.length) {
    const ids = hideUserIds.map((id) => new Types.ObjectId(id));
    and.push({ user: { $nin: ids } }, { actor: { $nin: ids } });
  }

  const user = q.get("user");
  if (user && isValidObjectId(user)) and.push({ $or: [{ user }, { actor: user }] });

  const task = q.get("task");
  if (task && isValidObjectId(task)) and.push({ task });

  const team = q.get("team");
  if (team && isValidObjectId(team)) and.push({ team });

  const type = q.get("type");
  if (type && ACTIVITY_TYPES.includes(type as ActivityType)) and.push({ type: type as ActivityType });

  const source = q.get("source");
  if (source && SOURCES.includes(source as Source)) and.push({ source: source as Source });

  const from = parseDate(q.get("from"));
  if (from) and.push({ createdAt: { $gte: from } });
  const to = parseDate(q.get("to"));
  if (to) and.push({ createdAt: { $lte: to } });
  const before = withCursor ? parseDate(q.get("before")) : null;
  if (before) and.push({ createdAt: { $lt: before } });

  const text = q.get("q")?.trim();
  if (text) {
    const re = { $regex: text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 100), $options: "i" };
    and.push({ $or: [{ message: re }, { rawText: re }] });
  }

  return and.length ? { $and: and } : {};
}

function parseDate(v: string | null) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
