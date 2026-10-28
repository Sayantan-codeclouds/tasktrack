import { POSITION_LABEL, TASK_STATUS_LABEL } from "./constants";
import { startPdf } from "./pdf";
import { rangeLabel } from "./eodPdf";
import type { TeamReport } from "./reports";

/** A team's EOD / EOW as a PDF for Managers and Team Leads — the work, not attendance. */
export function renderTeamReportPdf(r: TeamReport): Promise<Buffer> {
  const title = `${r.team.name} · Team ${r.period === "day" ? "EOD" : "EOW"} Report`;
  const pdf = startPdf({ title, subtitle: rangeLabel(r.period, r.from, r.to), author: r.team.name });

  pdf.infoGrid([
    ["Team", r.team.name],
    ["Team Lead", r.team.lead ?? "—"],
    ["Manager", r.team.manager ?? "—"],
    ["People", String(r.members.filter((m) => m.inTeam).length)],
  ]);
  pdf.stats([
    ["Completed", String(r.totals.completed)],
    ["Updates", String(r.totals.progressUpdates)],
    ["New tickets", String(r.totals.created)],
    ["Blocked", String(r.totals.blocked)],
    ["EOD notes", String(r.totals.eodNotes)],
  ]);

  pdf.heading("Tickets");
  if (r.tickets.length) {
    pdf.table(
      [
        { label: "Ticket", w: 0.09 },
        { label: "Task", w: 0.3 },
        { label: "Assignee", w: 0.15 },
        { label: "Status", w: 0.12 },
        { label: "Progress", w: 0.15 },
        { label: "Worked on by", w: 0.19 },
      ],
      r.tickets.map((t) => [
        t.key,
        t.title,
        t.assignee?.name ?? "—",
        t.completed ? "Done" : TASK_STATUS_LABEL[t.status],
        t.start !== t.end ? `${t.start}% → ${t.end}%` : `${t.end}%`,
        t.contributors.map((c) => c.name).join(", "),
      ]),
    );
  } else {
    pdf.paragraph("", `No ticket updates in this ${r.period}.`);
  }

  pdf.heading("People");
  pdf.table(
    [
      { label: "Name", w: 0.26 },
      { label: "Role", w: 0.2 },
      { label: "Done", w: 0.1, align: "right" },
      { label: "Moved", w: 0.1, align: "right" },
      { label: "New", w: 0.1, align: "right" },
      { label: "EOD", w: 0.24 },
    ],
    r.members
      .filter((m) => m.inTeam || m.events)
      .map((m) => [
        m.name,
        m.position ? POSITION_LABEL[m.position] : "—",
        String(m.completed.length),
        String(m.progressed.length),
        String(m.created.length),
        m.eodNotes.length ? "Written" : r.missingEodIds.includes(m._id) ? "Missing" : "—",
      ]),
  );

  const notes = r.members.flatMap((m) => m.eodNotes.map((n) => ({ name: m.name, text: n.text })));
  if (notes.length) {
    pdf.heading("EOD notes");
    for (const n of notes) pdf.paragraph(`${n.name}: ${n.text}`);
  }
  if (r.missingEod.length) {
    pdf.heading("No EOD yet");
    pdf.paragraph(r.missingEod.join(", "));
  }

  return pdf.finish(title, r.timeZone);
}
