import PDFDocument from "pdfkit";
import { formatDay } from "./time";
import { formatDuration } from "./reports";
import type { EodPage } from "./eod";

// A clean, printable A4 EOD / EOW for HR. Uses the built-in Helvetica, so text is kept to characters it can draw.

const INK = "#1f2430";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const ACCENT = "#4f46e5";
const SOFT = "#f4f5fb";
const M = 48; // page margin

/** Helvetica only knows Windows-1252. Swap the common extras and drop what it can't draw (emoji etc.). */
function safe(s: string) {
  return s
    .replace(/→/g, "->")
    .replace(/[✓✔✅]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—•…€]/gu, "")
    .trim();
}

interface Col {
  label: string;
  /** Share of the content width. */
  w: number;
  align?: "left" | "right" | "center";
}

export function renderEodPdf(p: EodPage): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: titleOf(p), Author: p.person.name, Creator: "TaskTrack" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const width = doc.page.width - M * 2;
  const bottom = () => doc.page.height - M - 18; // leave room for the footer
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  // ---------- header ----------
  doc.rect(0, 0, doc.page.width, 6).fill(ACCENT);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(titleOf(p), M, M);
  doc.font("Helvetica").fontSize(11).fillColor(MUTED).text(dateLine(p));
  doc.moveDown(0.8);

  // Who
  const who: [string, string][] = [
    ["Name", p.person.name],
    ["Role", p.person.role ?? "—"],
    ["Team", p.person.teams.join(", ") || "—"],
    ["Email", p.person.email],
  ];
  if (p.shift) who.push(["Shift", `${p.shift.start} – ${p.shift.end}`]);
  infoGrid(who);
  doc.moveDown(0.6);

  // ---------- attendance ----------
  if (p.period === "day") {
    const a = p.attendance[0];
    stats([
      ["Login", p.content.login || a?.login || "—"],
      ["Logout", p.content.logout || a?.logout || "—"],
      ["Online", formatDuration(a?.onlineMinutes ?? 0)],
      ["Break", formatDuration(a?.breakMinutes ?? 0)],
      ["Late by", a?.lateBy ? formatDuration(a.lateBy) : "On time"],
    ]);
  } else {
    stats([
      ["Days active", `${p.totals.activeDays}/${p.totals.workDays}`],
      ["Online", formatDuration(p.totals.onlineMinutes)],
      ["Break", formatDuration(p.totals.breakMinutes)],
      ["Late days", String(p.totals.lateDays)],
      ["Tickets done", String(p.totals.completed)],
    ]);
    heading("Attendance");
    table(
      [
        { label: "Day", w: 0.28 },
        { label: "Login", w: 0.14, align: "center" },
        { label: "Logout", w: 0.14, align: "center" },
        { label: "Online", w: 0.15, align: "right" },
        { label: "Break", w: 0.14, align: "right" },
        { label: "Late", w: 0.15, align: "right" },
      ],
      p.attendance
        .filter((a) => a.workDay || a.onlineMinutes || a.login)
        .map((a) => [
          formatDay(a.day, { weekday: "short", day: "numeric", month: "short" }),
          a.login || "—",
          a.logout || "—",
          a.onlineMinutes ? formatDuration(a.onlineMinutes) : "—",
          a.breakMinutes ? formatDuration(a.breakMinutes) : "—",
          a.lateBy ? formatDuration(a.lateBy) : "",
        ]),
    );
  }

  // ---------- the editable parts ----------
  heading(p.period === "day" ? "Summary of the day" : "Summary of the week");
  paragraph(p.content.summary, "No summary written.");

  heading(p.period === "day" ? "Tasks worked on" : "Tasks this week");
  if (p.content.tasks.length) {
    table(
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
    paragraph("", "No tasks recorded.");
  }

  if (p.content.blockers.trim()) {
    heading("Blockers / issues");
    paragraph(p.content.blockers, "");
  }

  heading(p.period === "day" ? "Plan for tomorrow" : "Plan for next week");
  paragraph(p.content.plan, "—");

  // ---------- footer on every page ----------
  const generated = new Intl.DateTimeFormat("en-GB", { timeZone: p.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - M + 10;
    doc.page.margins.bottom = 0; // writing in the margin mustn't start a new page
    doc.moveTo(M, y - 6).lineTo(doc.page.width - M, y - 6).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    doc.text(safe(`${p.person.name} · ${titleOf(p)} · Generated by TaskTrack on ${generated} (${p.timeZone})`), M, y, { width: width - 60, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, M, y, { width, align: "right", lineBreak: false });
  }
  doc.end();
  return done;

  // ---------- helpers ----------
  function heading(text: string) {
    doc.moveDown(0.9);
    ensure(48);
    doc.x = M;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(text, M, doc.y);
    const y = doc.y + 3;
    doc.moveTo(M, y).lineTo(M + 28, y).lineWidth(2).strokeColor(ACCENT).stroke();
    doc.y = y + 8;
  }

  function paragraph(text: string, empty: string) {
    const body = safe(text);
    doc.font("Helvetica").fontSize(10.5).fillColor(body ? INK : MUTED);
    for (const para of (body || empty).split(/\n{2,}/)) {
      if (!para) continue;
      // Long text flows onto the next page by itself; just don't start a paragraph at the very bottom.
      ensure(Math.min(doc.heightOfString(para, { width }), 40));
      doc.text(para, M, doc.y, { width, lineGap: 2 });
      doc.moveDown(0.4);
    }
  }

  function infoGrid(items: [string, string][]) {
    const colW = width / 2;
    let y = doc.y;
    items.forEach(([k, v], i) => {
      const x = M + (i % 2) * colW;
      if (i % 2 === 0 && i) y += 30;
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(k.toUpperCase(), x, y, { width: colW - 12, characterSpacing: 0.4 });
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(safe(v), x, y + 11, { width: colW - 12, lineBreak: false, ellipsis: true });
    });
    doc.y = y + 30;
    doc.x = M;
  }

  function stats(items: [string, string][]) {
    ensure(56);
    const gap = 8;
    const w = (width - gap * (items.length - 1)) / items.length;
    const y = doc.y;
    items.forEach(([k, v], i) => {
      const x = M + i * (w + gap);
      doc.roundedRect(x, y, w, 48, 6).fill(SOFT);
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(k.toUpperCase(), x + 10, y + 9, { width: w - 20, characterSpacing: 0.4 });
      doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(safe(v), x + 10, y + 23, { width: w - 20, lineBreak: false, ellipsis: true });
    });
    doc.y = y + 48;
    doc.x = M;
  }

  function table(cols: Col[], rows: string[][]) {
    const xs: number[] = [];
    let x = M;
    for (const c of cols) {
      xs.push(x);
      x += c.w * width;
    }
    const pad = 5;
    const header = () => {
      const y = doc.y;
      doc.rect(M, y, width, 20).fill(SOFT);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
      cols.forEach((c, i) => doc.text(c.label.toUpperCase(), xs[i] + pad, y + 6.5, { width: c.w * width - pad * 2, align: c.align, lineBreak: false }));
      doc.y = y + 20;
    };
    ensure(44);
    header();
    doc.font("Helvetica").fontSize(9.5);
    for (const row of rows) {
      const cells = row.map((v) => safe(v ?? "") || "");
      const h = Math.max(...cells.map((v, i) => doc.heightOfString(v || " ", { width: cols[i].w * width - pad * 2 }))) + pad * 2;
      if (doc.y + h > bottom()) {
        doc.addPage();
        header();
        doc.font("Helvetica").fontSize(9.5);
      }
      const y = doc.y;
      cells.forEach((v, i) => doc.fillColor(i === 0 ? MUTED : INK).text(v, xs[i] + pad, y + pad, { width: cols[i].w * width - pad * 2, align: cols[i].align }));
      doc.moveTo(M, y + h).lineTo(M + width, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + h;
    }
    doc.x = M;
  }
}

function titleOf(p: EodPage) {
  return p.period === "day" ? "End of Day Report" : "End of Week Report";
}

function dateLine(p: EodPage) {
  return p.period === "day"
    ? formatDay(p.from, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : `${formatDay(p.from, { day: "numeric", month: "long" })} – ${formatDay(p.to, { day: "numeric", month: "long", year: "numeric" })}`;
}
