import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { ActivityLog } from "@/lib/models/ActivityLog";
import { buildLogFilter } from "@/lib/logQuery";
import { hiddenIdsFor } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/logs?user=&task=&type=&source=&from=&to=&q=&before=&limit=&count=1
 * Newest first. Pass the returned `nextCursor` as `before` to load older entries.
 * With count=1 the response also includes `total` for the filters (ignoring the cursor).
 */
export const GET = withUser(async (req, { user }) => {
  const q = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(q.get("limit")) || 30, 1), 100);
  const hideUserIds = await hiddenIdsFor(user);

  // summary=1 → counts per activity type for the filters (no paging).
  if (q.get("summary") === "1") {
    const rows = await ActivityLog.aggregate<{ _id: string; n: number }>([
      // .cast() turns id strings into ObjectIds — aggregate() doesn't do that by itself.
      { $match: ActivityLog.find(buildLogFilter(q, { withCursor: false, hideUserIds })).cast() },
      { $group: { _id: "$type", n: { $sum: 1 } } },
    ]);
    return NextResponse.json({ byType: Object.fromEntries(rows.map((r) => [r._id, r.n])) });
  }

  const [logs, total] = await Promise.all([
    ActivityLog.find(buildLogFilter(q, { hideUserIds }))
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("user", "name")
      .populate("actor", "name")
      .populate("task", "title")
      .lean(),
    q.get("count") === "1" ? ActivityLog.countDocuments(buildLogFilter(q, { withCursor: false, hideUserIds })) : null,
  ]);

  const hasMore = logs.length > limit;
  const page = hasMore ? logs.slice(0, limit) : logs;
  return NextResponse.json({
    logs: page,
    nextCursor: hasMore ? page[page.length - 1].createdAt : null,
    ...(total !== null ? { total } : {}),
  });
});
