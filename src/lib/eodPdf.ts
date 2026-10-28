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

  pdf.heading(p.period === "day" ? "Tasks worked on" : "Tasks this week");
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

/** "Tuesday, 27 October 2026" or "26 October – 1 November 2026". */
export function rangeLabel(period: "day" | "week", from: string, to: string) {
  return period === "day"
    ? formatDay(from, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : `${formatDay(from, { day: "numeric", month: "long" })} – ${formatDay(to, { day: "numeric", month: "long", year: "numeric" })}`;
}
