import { withUser } from "@/lib/api";
import { ActivityLog } from "@/lib/models/ActivityLog";
import { buildLogFilter } from "@/lib/logQuery";
import { hiddenIdsFor } from "@/lib/admin";
import { ACTIVITY_LABEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;

/** GET /api/logs/export?<same filters as /api/logs> → CSV download (newest first). */
export const GET = withUser(async (req, { user }) => {
  const q = new URL(req.url).searchParams;
  const logs = await ActivityLog.find(buildLogFilter(q, { withCursor: false, hideUserIds: await hiddenIdsFor(user) }))
    .sort({ createdAt: -1 })
    .limit(MAX_ROWS)
    .populate<{ user: { name: string } | null }>("user", "name")
    .populate<{ actor: { name: string } | null }>("actor", "name")
    .populate<{ task: { title: string } | null }>("task", "title")
    .lean();

  const tz = process.env.APP_TIMEZONE || "UTC";
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    dateStyle: "short",
    timeStyle: "medium",
  });

  const rows = [
    ["Time (UTC)", `Time (${tz})`, "Person", "Done by", "Type", "Message", "Task", "Source", "Telegram message", "AI confidence"],
    ...logs.map((l) => [
      l.createdAt.toISOString(),
      local.format(l.createdAt),
      l.user?.name ?? "",
      l.actor?.name ?? "",
      ACTIVITY_LABEL[l.type],
      l.message,
      l.task?.title ?? "",
      l.source,
      l.rawText ?? "",
      l.aiConfidence != null ? `${Math.round(l.aiConfidence * 100)}%` : "",
    ]),
  ];

  // BOM so Excel opens UTF-8 (names, emoji, ₹ …) correctly.
  const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tasktrack-activity-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});

function csvCell(v: string) {
  // Quote everything; neutralise leading =,+,-,@ so spreadsheets don't run it as a formula.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}
