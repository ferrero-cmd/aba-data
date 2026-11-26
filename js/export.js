// Builds the Excel workbook for one session and hands it to the share sheet (Outlook / Mail).
import { emailSubject, TYPES, targetSpec } from "./model.js";
import { fmtClock, fmtDate, fmtTime, isoDate, rawTable, sessionMs, summarize } from "./summary.js";
import { shareFile, toast } from "./ui.js";

let excelP;
function loadExcel() {
  excelP ??= new Promise((resolve, reject) => {
    if (window.ExcelJS) return resolve(window.ExcelJS);
    const s = document.createElement("script");
    s.src = "vendor/exceljs.min.js";
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => { excelP = null; reject(new Error("Couldn't load the Excel library.")); };
    document.head.append(s);
  });
  return excelP;
}
export const preloadExcel = () => loadExcel().catch(() => {});

const ACCENT = "FF0F766E";
const SOFT = "FFE2F1EE";
const LINE = "FFDFE3DF";

export const exportFilename = (client, session) =>
  `${emailSubject(client)} - ${isoDate(session.startedAt)}.xlsx`;

function sheetName(i, name, used) {
  let base = `${i + 1} ${name}`.replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim();
  let n = base;
  let k = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${k++}`;
  used.add(n.toLowerCase());
  return n;
}

function styleHeader(row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  row.height = 22;
}

function autoWidth(ws, min = 10, max = 48) {
  ws.columns.forEach((col) => {
    let w = min;
    col.eachCell({ includeEmpty: false }, (c) => { w = Math.max(w, String(c.value ?? "").length + 2); });
    col.width = Math.min(max, w);
  });
}

export async function buildWorkbook(client, session) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "ABA Data";
  wb.created = new Date(session.startedAt);

  const e = sessionMs(session);

  // ---- Summary sheet ----
  const ws = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 26 }, { width: 22 }, { width: 18 }, { width: 30 }, { width: 46 }];
  const title = ws.addRow([emailSubject(client)]);
  title.font = { bold: true, size: 16, color: { argb: ACCENT } };
  ws.addRow([]);
  const info = [
    ["Client", `${client.first} (first initial)`],
    ["School", `${client.school} (school initial)`],
    ...(client.label ? [["Note", client.label]] : []),
    ["Date", fmtDate(session.startedAt)],
    ["Start", fmtTime(session.startedAt)],
    ["End", session.endedAt ? fmtTime(session.endedAt) : "In progress"],
    ["Observation time", `${fmtClock(e)} (${Math.round((e / 60000) * 10) / 10} min, pauses excluded)`],
    ...(session.observer ? [["Observer", session.observer]] : []),
    ...(session.notes ? [["Notes", session.notes]] : []),
  ];
  for (const [k, v] of info) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true, color: { argb: "FF5D6A66" } };
    ws.mergeCells(r.number, 2, r.number, 5);
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
  ws.addRow([]);
  const head = ws.addRow(["Target", "Data type", "Result", "Key measures", "Definition"]);
  styleHeader(head);
  session.trackers.forEach((tr, i) => {
    const s = summarize(tr, session, e);
    const r = ws.addRow([tr.name, targetSpec(tr), s.headline,
      s.details.map(([k, v]) => `${k}: ${v}`).join("\n"), tr.definition || ""]);
    r.alignment = { wrapText: true, vertical: "top" };
    r.getCell(1).font = { bold: true };
    if (i % 2) r.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } }; });
    r.eachCell((c) => { c.border = { bottom: { style: "thin", color: { argb: LINE } } }; });
  });

  // ---- One sheet of raw data per tracker ----
  const used = new Set(["summary"]);
  session.trackers.forEach((tr, i) => {
    const t = wb.addWorksheet(sheetName(i, tr.name, used), { views: [{ state: "frozen", ySplit: 3 }] });
    const { columns, rows } = rawTable(tr, session);
    const top = t.addRow([`${tr.name} — ${TYPES[tr.type].label}`]);
    top.font = { bold: true, size: 13, color: { argb: ACCENT } };
    t.addRow([summarize(tr, session, e).headline + (tr.definition ? ` · ${tr.definition}` : "")]).font = { italic: true, color: { argb: "FF5D6A66" } };
    styleHeader(t.addRow(columns));
    if (!rows.length) t.addRow(["No data recorded"]).font = { italic: true, color: { argb: "FF5D6A66" } };
    rows.forEach((r, j) => {
      const row = t.addRow(r);
      if (j % 2) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } }; });
    });
    autoWidth(t);
    t.getColumn(1).width = Math.max(t.getColumn(1).width, 9);
    t.getRow(1).getCell(1).alignment = { wrapText: false };
  });

  const buf = await wb.xlsx.writeBuffer();
  return new File([buf], exportFilename(client, session), {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// Copy the subject (Outlook ignores it from the share sheet), then open the share sheet with the file.
export async function emailSession(client, session, prepared) {
  const subject = emailSubject(client);
  navigator.clipboard?.writeText(subject).catch(() => {});
  const file = prepared || (await buildWorkbook(client, session));
  const result = await shareFile(file, subject);
  if (result === "retry") toast("Ready — tap Email again");
  else if (result === "shared") toast(`Subject copied: ${subject}`, 3200);
  else if (result === "downloaded") {
    toast("Excel file downloaded");
    location.href = `mailto:?subject=${encodeURIComponent(subject)}`;
  }
  return result;
}

