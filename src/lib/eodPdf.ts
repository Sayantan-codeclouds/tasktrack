import { TASK_STATUS_LABEL } from "./constants";
import { formatDay } from "./time";
import { startPdf } from "./pdf";
import type { EodPage } from "./eod";

/** A member's EOD / EOW for HR — the work only; attendance stays on the page. */
export function renderEodPdf(p: EodPage): Promise<Buffer> {
  const title = p.period === "day" ? "End of Day Report" : "End of Week Report";
  const pdf = startPdf({ title, subtitle: rangeLabel(p.period, p.from, p.to), author: p.person.name });

  pdf.infoGrid([
    ["Name", p.person.name],
    ["Role", p.person.role ?? "—"],
    ["Team", p.person.teams.join(", ") || "—"],
    ["Email", p.person.email],
  ]);

  pdf.heading(p.period === "day" ? "Summary of the day" : "Summary of the week");
  pdf.paragraph(p.content.summary, "No summary written.");

  const overseer = /manager|team lead/i.test(p.person.role ?? "");
  pdf.heading(overseer ? "Team tasks — open and done, and by whom" : p.period === "day" ? "Tasks worked on" : "Tasks this week");
  if (p.content.tasks.length) {
    pdf.table(
      [
        { label: "Ticket", w: 0.11 },
        { label: "Task", w: 0.37 },
        { label: "Status", w: 0.14 },
        { label: "Progress", w: 0.14 },
        { label: "Remarks", w: 0.24 },
      ],
      p.content.tasks.map((t) => [t.ticket, t.title, t.status, t.progress, t.remarks]),
    );
  } else {
    pdf.paragraph("", "No tasks recorded.");
  }

  if (p.content.blockers.trim()) {
    pdf.heading("Blockers / issues");
    pdf.paragraph(p.content.blockers);
  }

  pdf.heading(p.period === "day" ? "Plan for tomorrow" : "Plan for next week");
  pdf.paragraph(p.content.plan, "—");

  return pdf.finish(`${p.person.name} · ${title}`, p.timeZone);
}

/**
 * Everyone's EOD / EOW in one PDF, for a Team Lead or Manager: per person, what they worked on and their
 * current open tickets. The work only — no attendance.
 */
export function renderEveryoneEodPdf(pages: EodPage[], period: "day" | "week", from: string, to: string, timeZone: string): Promise<Buffer> {
  const title = period === "day" ? "Everyone's EOD" : "Everyone's EOW";
  const pdf = startPdf({ title, subtitle: rangeLabel(period, from, to), author: "TaskTrack" });

  if (!pages.length) pdf.paragraph("", "Nobody to show.");
  for (const p of pages) {
    pdf.heading(`${p.person.name}${p.person.role ? ` · ${p.person.role}` : ""}`);
    if (p.content.summary.trim()) pdf.paragraph(p.content.summary);
    if (p.content.tasks.length) {
      pdf.table(
        [
          { label: "Ticket", w: 0.11 },
          { label: period === "day" ? "Worked on" : "Worked on this week", w: 0.4 },
          { label: "Status", w: 0.14 },
          { label: "Progress", w: 0.14 },
          { label: "Remarks", w: 0.21 },
        ],
        p.content.tasks.map((t) => [t.ticket, t.title, t.status, t.progress, t.remarks]),
      );
    }
    if (p.openTasks.length) {
      pdf.table(
        [
          { label: "Ticket", w: 0.11 },
          { label: "Current tasks", w: 0.54 },
          { label: "Status", w: 0.2 },
          { label: "Progress", w: 0.15, align: "right" },
        ],
        p.openTasks.map((t) => [t.key, t.title, TASK_STATUS_LABEL[t.status], `${t.progress}%`]),
      );
    }
    if (!p.content.tasks.length && !p.openTasks.length) pdf.paragraph("", "No tasks.");
    if (p.content.blockers.trim()) pdf.paragraph(`Blockers: ${p.content.blockers}`);
  }
  return pdf.finish(title, timeZone);
}

/** "Tuesday, 27 October 2026" or "26 October – 1 November 2026". */
export function rangeLabel(period: "day" | "week", from: string, to: string) {
  return period === "day"
    ? formatDay(from, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : `${formatDay(from, { day: "numeric", month: "long" })} – ${formatDay(to, { day: "numeric", month: "long", year: "numeric" })}`;
}
