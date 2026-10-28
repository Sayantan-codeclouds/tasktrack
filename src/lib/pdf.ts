import PDFDocument from "pdfkit";

// Building blocks for TaskTrack's A4 PDFs (EOD / EOW for HR, team reports): one look everywhere.
// Uses the built-in Helvetica, so text is kept to characters it can draw.

const INK = "#1f2430";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";
const ACCENT = "#4f46e5";
const SOFT = "#f4f5fb";
const M = 48; // page margin

/** Helvetica only knows Windows-1252. Swap the common extras and drop what it can't draw (emoji etc.). */
export function safe(s: string) {
  return s
    .replace(/→/g, "->")
    .replace(/[✓✔✅]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—•…€]/gu, "")
    .trim();
}

export interface Col {
  label: string;
  /** Share of the content width. */
  w: number;
  align?: "left" | "right" | "center";
}

/** Starts a PDF with the title block; draw with the returned helpers, then `finish()`. */
export function startPdf(opts: { title: string; subtitle: string; author: string }) {
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: opts.title, Author: opts.author, Creator: "TaskTrack" } });
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

  doc.rect(0, 0, doc.page.width, 6).fill(ACCENT);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(safe(opts.title), M, M);
  doc.font("Helvetica").fontSize(11).fillColor(MUTED).text(safe(opts.subtitle));
  doc.moveDown(0.8);

  function heading(text: string) {
    doc.moveDown(0.9);
    ensure(48);
    doc.x = M;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(safe(text), M, doc.y);
    const y = doc.y + 3;
    doc.moveTo(M, y).lineTo(M + 28, y).lineWidth(2).strokeColor(ACCENT).stroke();
    doc.y = y + 8;
  }

  function paragraph(text: string, empty = "") {
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

  /** Label / value pairs, two per row. */
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

  /** A row of number tiles. */
  function stats(items: [string, string][]) {
    doc.moveDown(0.4);
    ensure(56);
    const gap = 8;
    const w = (width - gap * (items.length - 1)) / items.length;
    const y = doc.y;
    items.forEach(([k, v], i) => {
      const x = M + i * (w + gap);
      doc.roundedRect(x, y, w, 48, 6).fill(SOFT);
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(k.toUpperCase(), x + 10, y + 9, { width: w - 20, characterSpacing: 0.4, lineBreak: false, ellipsis: true });
      doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(safe(v), x + 10, y + 23, { width: w - 20, lineBreak: false, ellipsis: true });
    });
    doc.y = y + 48;
    doc.x = M;
  }

  /** A table whose header repeats on every page it runs onto. */
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
      const cells = row.map((v) => safe(v ?? ""));
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

  /** Footer with page numbers on every page, then the finished file. */
  function finish(footer: string, timeZone: string) {
    const generated = new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date());
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - M + 10;
      doc.page.margins.bottom = 0; // writing in the margin mustn't start a new page
      doc.moveTo(M, y - 6).lineTo(doc.page.width - M, y - 6).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font("Helvetica").fontSize(8).fillColor(MUTED);
      doc.text(safe(`${footer} · Generated by TaskTrack on ${generated} (${timeZone})`), M, y, { width: width - 60, lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, M, y, { width, align: "right", lineBreak: false });
    }
    doc.end();
    return done;
  }

  return { heading, paragraph, infoGrid, stats, table, finish };
}
