// Builds the Excel workbook for one or several sessions and hands it to the share sheet (Outlook / Mail).
import { emailSubject, TYPES, targetSpec } from "./model.js";
import { fmtClock, fmtDate, fmtTime, isoDate, rawTable, sessionMs, summarize } from "./summary.js";
import { shareFile, toast } from "./ui.js";
import { addCharts, GRAPH_SHEET, graphData, writeGraphSheets } from "./xlsxcharts.js";

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
let zipP;
function loadZip() {
  zipP ??= new Promise((resolve, reject) => {
    if (window.JSZip) return resolve(window.JSZip);
    const s = document.createElement("script");
    s.src = "vendor/jszip.min.js";
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => { zipP = null; reject(new Error("Couldn't load the zip library.")); };
    document.head.append(s);
  });
  return zipP;
}
export const preloadExcel = () => Promise.all([loadExcel(), loadZip()]).catch(() => {});

const ACCENT = "FF0F766E";
const SOFT = "FFE2F1EE";
const LINE = "FFDFE3DF";

const byStart = (xs) => [...xs].sort((a, b) => a.startedAt - b.startedAt);

export function exportFilename(client, sessions) {
  const ss = byStart(sessions);
  const d1 = isoDate(ss[0].startedAt);
  const d2 = isoDate(ss.at(-1).startedAt);
  return `${emailSubject(client)} - ${d1 === d2 ? d1 : `${d1} to ${d2}`}.xlsx`;
}

function sheetName(name, used) {
  const base = String(name).replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim();
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

const stripe = (row, j) => { if (j % 2) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } }; }); };
const underline = (row) => row.eachCell((c) => { c.border = { bottom: { style: "thin", color: { argb: LINE } } }; });

function autoWidth(ws, min = 10, max = 48) {
  ws.columns.forEach((col) => {
    let w = min;
    col.eachCell({ includeEmpty: false }, (c) => { w = Math.max(w, String(c.value ?? "").length + 2); });
    col.width = Math.min(max, w);
  });
}

function infoRows(ws, rows) {
  for (const [k, v] of rows) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true, color: { argb: "FF5D6A66" } };
    ws.mergeCells(r.number, 2, r.number, 5);
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
}

const periodsOf = (session) => [...new Set((session.periodLog || []).map((p) => p.name).filter(Boolean))];
const minutes = (ms) => Math.round((ms / 60000) * 10) / 10;

// One raw-data sheet per tracker of a session. prefix (e.g. "Nov 3") keeps several sessions apart.
function rawSheets(wb, session, used, prefix = "") {
  const e = sessionMs(session);
  session.trackers.forEach((tr, i) => {
    const t = wb.addWorksheet(sheetName(prefix ? `${prefix} ${tr.name}` : `${i + 1} ${tr.name}`, used), { views: [{ state: "frozen", ySplit: 3 }] });
    const { columns, rows } = rawTable(tr, session);
    const top = t.addRow([`${tr.name} — ${TYPES[tr.type].label}${prefix ? ` · ${fmtDate(session.startedAt)} ${fmtTime(session.startedAt)}` : ""}`]);
    top.font = { bold: true, size: 13, color: { argb: ACCENT } };
    t.addRow([summarize(tr, session, e).headline + (tr.definition ? ` · ${tr.definition}` : "")]).font = { italic: true, color: { argb: "FF5D6A66" } };
    styleHeader(t.addRow(columns));
    if (!rows.length) t.addRow(["No data recorded"]).font = { italic: true, color: { argb: "FF5D6A66" } };
    rows.forEach((r, j) => stripe(t.addRow(r), j));
    autoWidth(t);
    t.getColumn(1).width = Math.max(t.getColumn(1).width, 9);
    t.getRow(1).getCell(1).alignment = { wrapText: false };
  });
}

// sessions: the ones going in the file. allSessions: every session for the client (for the graphs).
export async function buildWorkbook(client, sessions, allSessions = sessions) {
  const [ExcelJS, JSZip] = await Promise.all([loadExcel(), loadZip().catch(() => null)]);
  const ss = byStart(sessions);
  const single = ss.length === 1;
  const wb = new ExcelJS.Workbook();
  wb.creator = "ABA Data";
  wb.created = new Date(ss[0].startedAt);

  const ws = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  const title = ws.addRow([emailSubject(client)]);
  title.font = { bold: true, size: 16, color: { argb: ACCENT } };
  ws.addRow([]);
  const who = [
    ["Client", `${client.first} (first initial)`],
    ["School", `${client.school} (school initial)`],
    ...(client.label ? [["Note", client.label]] : []),
  ];
  const used = new Set(["summary", "graphs", "graph data"]);
  // Graphs go second (filled in at the end), so they're one tap from the summary.
  const graphsWs = JSZip ? wb.addWorksheet(GRAPH_SHEET, { views: [{ showGridLines: false }] }) : null;

  if (single) {
    const session = ss[0];
    const e = sessionMs(session);
    const periods = periodsOf(session);
    ws.columns = [{ width: 26 }, { width: 22 }, { width: 18 }, { width: 30 }, { width: 46 }];
    infoRows(ws, [...who,
      ["Date", fmtDate(session.startedAt)],
      ["Start", fmtTime(session.startedAt)],
      ["End", session.endedAt ? fmtTime(session.endedAt) : "In progress"],
      ["Observation time", `${fmtClock(e)} (${minutes(e)} min, pauses excluded)`],
      ...(session.observer ? [["Observer", session.observer]] : []),
      ...(periods.length ? [["Periods / activities", periods.join(", ")]] : []),
      ...(session.notes ? [["Notes", session.notes]] : [])]);
    ws.addRow([]);
    styleHeader(ws.addRow(["Target", "Data type", "Result", "Key measures", "Definition"]));
    session.trackers.forEach((tr, i) => {
      const s = summarize(tr, session, e);
      const r = ws.addRow([tr.name, targetSpec(tr), s.headline, s.details.map(([k, v]) => `${k}: ${v}`).join("\n"), tr.definition || ""]);
      r.alignment = { wrapText: true, vertical: "top" };
      r.getCell(1).font = { bold: true };
      stripe(r, i);
      underline(r);
    });
    rawSheets(wb, session, used);
  } else {
    const total = ss.reduce((a, s) => a + sessionMs(s), 0);
    const observers = [...new Set(ss.map((s) => s.observer).filter(Boolean))];
    ws.columns = [{ width: 14 }, { width: 11 }, { width: 11 }, { width: 24 }, { width: 18 }, { width: 22 }, { width: 46 }];
    infoRows(ws, [...who,
      ["Sessions", `${ss.length} (${fmtDate(ss[0].startedAt)} – ${fmtDate(ss.at(-1).startedAt)})`],
      ["Observation time", `${fmtClock(total)} total (${minutes(total)} min, pauses excluded)`],
      ...(observers.length ? [["Observer", observers.join(", ")]] : [])]);
    ws.addRow([]);
    styleHeader(ws.addRow(["Date", "Start", "Observed", "Target", "Data type", "Result", "Key measures"]));
    let j = 0;
    for (const session of ss) {
      const e = sessionMs(session);
      session.trackers.forEach((tr, i) => {
        const s = summarize(tr, session, e);
        const r = ws.addRow([i ? "" : fmtDate(session.startedAt), i ? "" : fmtTime(session.startedAt).replace(/:\d\d(?=\s|$)/, ""), i ? "" : fmtClock(e),
          tr.name, targetSpec(tr), s.headline, s.details.map(([k, v]) => `${k}: ${v}`).join("\n")]);
        r.alignment = { wrapText: true, vertical: "top" };
        r.getCell(4).font = { bold: true };
        stripe(r, j);
        underline(r);
      });
      if (session.notes) {
        const r = ws.addRow(["", "", "", "Notes", session.notes]);
        ws.mergeCells(r.number, 5, r.number, 7);
        r.getCell(5).alignment = { wrapText: true, vertical: "top" };
        r.getCell(4).font = { italic: true, color: { argb: "FF5D6A66" } };
        stripe(r, j);
      }
      j++;
    }

    // One sheet per target: a row per session with every measure.
    const targetIds = [...new Set(ss.flatMap((s) => s.trackers.map((tr) => tr.targetId)))];
    for (const id of targetIds) {
      const rows = ss.flatMap((s) => s.trackers.filter((tr) => tr.targetId === id).map((tr) => ({ s, tr, sum: summarize(tr, s) })));
      const first = rows[0];
      const t = wb.addWorksheet(sheetName(first.tr.name, used), { views: [{ state: "frozen", ySplit: 3 }] });
      const top = t.addRow([`${first.tr.name} — ${TYPES[first.tr.type].label}`]);
      top.font = { bold: true, size: 13, color: { argb: ACCENT } };
      t.addRow([`${targetSpec(first.tr)} · one row per session${first.tr.definition ? ` · ${first.tr.definition}` : ""}`]).font = { italic: true, color: { argb: "FF5D6A66" } };
      const metrics = first.sum.metrics;
      styleHeader(t.addRow(["Date", "Start", "Observed", "Result", ...metrics.map((m) => `${m.label}${m.unit && m.unit !== "%" ? ` (${m.unit.replace(/^\//, "per ")})` : m.unit === "%" ? " (%)" : ""}`)]));
      rows.forEach(({ s, sum }, k) => stripe(t.addRow([fmtDate(s.startedAt), fmtTime(s.startedAt).replace(/:\d\d(?=\s|$)/, ""), fmtClock(sessionMs(s)), sum.headline,
        ...metrics.map((m) => sum.metrics.find((x) => x.key === m.key)?.value ?? "")]), k));
      autoWidth(t, 10, 30);
      t.getRow(1).getCell(1).alignment = { wrapText: false };
    }

    // Raw taps, per session.
    for (const session of ss) {
      const d = new Date(session.startedAt);
      let prefix = d.toLocaleDateString([], { month: "short", day: "numeric" });
      if (ss.filter((x) => isoDate(x.startedAt) === isoDate(session.startedAt)).length > 1) prefix += ` ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "")}`;
      rawSheets(wb, session, used, prefix);
    }
  }

  // Graphs: every finished session to date for each target in this file.
  let specs = [];
  try { specs = graphsWs ? writeGraphSheets(wb, graphData(client, ss, allSessions), { accent: ACCENT }) : []; } catch (err) {
    console.error(err);
    specs = [];
    if (wb.getWorksheet(GRAPH_SHEET)) wb.removeWorksheet(wb.getWorksheet(GRAPH_SHEET).id);
  }

  let buf = await wb.xlsx.writeBuffer();
  if (specs.length) {
    try { buf = await addCharts(buf, specs, JSZip); } catch (err) { console.error(err); toast("Graphs couldn't be added — data is all there"); }
  }
  return new File([buf], exportFilename(client, ss), {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// Copy the subject (Outlook ignores it from the share sheet), then open the share sheet with the file.
export async function emailSessions(client, sessions, prepared, allSessions = sessions) {
  const subject = emailSubject(client);
  navigator.clipboard?.writeText(subject).catch(() => {});
  const file = prepared || (await buildWorkbook(client, sessions, allSessions));
  const result = await shareFile(file, subject);
  if (result === "retry") toast("Ready — tap Email again");
  else if (result === "shared") toast(`Subject copied: ${subject}`, 3200);
  else if (result === "downloaded") {
    toast("Excel file downloaded");
    location.href = `mailto:?subject=${encodeURIComponent(subject)}`;
  }
  return result;
}

