import { POSITION_LABEL, TASK_STATUS_LABEL } from "./constants";
import { startPdf } from "./pdf";
import { rangeLabel } from "./eodPdf";
import { partsText, type TeamReport } from "./reports";

/** A team's EOD / EOW as a PDF for Managers and Team Leads: the work, plus who was late or absent (no login / logout times). */
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
        // Same subject, several tickets (design + development): each one's progress.
        t.parts ? partsText(t) : t.start !== t.end ? `${t.start}% → ${t.end}%` : `${t.end}%`,
        t.contributors.map((c) => c.name).join(", "),
      ]),
    );
  } else {
    pdf.paragraph("", `No ticket updates in this ${r.period}.`);
  }

  pdf.heading("People");
  const attendance = (m: TeamReport["members"][number]) => {
    if (r.period === "week") return m.absentDays.length ? `Absent ${m.absentDays.length}d` : m.lateDays ? `Late ${m.lateDays}d` : "—";
    const d = m.days[r.from];
    if (d?.absent) return d.firstOnline ? "Absent (came later)" : "Absent";
    return d?.lateBy ? `Late ${d.lateBy}m` : d?.firstOnline ? "On time" : "—";
  };
  const people = r.members.filter((m) => m.inTeam || m.events);
  pdf.table(
    r.period === "day"
      ? [
          { label: "Name", w: 0.24 },
          { label: "Role", w: 0.2 },
          { label: "Attendance", w: 0.18 },
          { label: "Done", w: 0.1, align: "right" },
          { label: "Moved", w: 0.1, align: "right" },
          { label: "EOD", w: 0.18 },
        ]
      : [
          { label: "Name", w: 0.22 },
          { label: "Role", w: 0.18 },
          { label: "Active days", w: 0.12, align: "right" },
          { label: "Attendance", w: 0.16 },
          { label: "Done", w: 0.08, align: "right" },
          { label: "Moved", w: 0.08, align: "right" },
          { label: "EOD notes", w: 0.16, align: "right" },
        ],
    people.map((m) => {
      const eod = m.eodNotes.length ? "Written" : r.missingEodIds.includes(m._id) ? "Missing" : "—";
      return r.period === "day"
        ? [
            m.name,
            m.position ? POSITION_LABEL[m.position] : "—",
            attendance(m),
            String(m.completed.length),
            String(m.progressed.length),
            eod,
          ]
        : [
            m.name,
            m.position ? POSITION_LABEL[m.position] : "—",
            `${m.activeDays.length}/${r.workDays}`,
            attendance(m),
            String(m.completed.length),
            String(m.progressed.length),
            String(m.eodNotes.length),
          ];
    }),
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
