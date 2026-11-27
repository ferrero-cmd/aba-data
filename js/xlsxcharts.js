// Native, editable Excel charts for the export. ExcelJS can't write charts, so:
//  1. graphData() works out the same series the Graphs tab draws (pure, testable),
//  2. writeGraphSheets() puts that data on a "Graph data" sheet with ExcelJS and leaves an empty "Graphs" sheet,
//  3. addCharts() opens the finished .xlsx with JSZip and adds one scatter-with-lines chart per target
//     to the Graphs sheet, pointing at the Graph data cells.
// ABA conventions kept: x = session number, the data path breaks at every phase change (one series per
// phase), dashed vertical phase-change lines between sessions, labelled with the phase name.
import { DBR_ITEMS, TYPES } from "./model.js";
import { isoDate, summarize } from "./summary.js";

export const DATA_SHEET = "Graph data";
export const GRAPH_SHEET = "Graphs";
const COLORS = { s0: "0F766E", s1: "2A78D6", s2: "EB6834", s3: "1BAF7A" };
const PHASE_COLOR = "7A8783";

// ---------- 1. data ----------
function phasesFor(client, target) {
  return (client.phases || [])
    .filter((p) => !p.targetIds?.length || p.targetIds.includes(target.id))
    .map((p) => ({ ...p, t: new Date(`${p.date}T00:00:00`).getTime() }))
    .sort((a, b) => a.t - b.t);
}

// For each target in the exported sessions: every finished session to date (up to the last exported one).
// → [{ target, title, unit, yMax, rows: [{ n, date, sessionId, inFile, seg, vals: { key: v } }], items, segments, phaseLines }]
export function graphData(client, exported, allSessions) {
  const last = Math.max(...exported.map((s) => s.startedAt));
  const inFile = new Set(exported.map((s) => s.id));
  const done = allSessions
    .filter((s) => (s.status === "done" || inFile.has(s.id)) && s.startedAt <= last)
    .sort((a, b) => a.startedAt - b.startedAt);
  const ids = new Set(exported.flatMap((s) => s.trackers.map((tr) => tr.targetId)));
  const targets = client.targets.filter((t) => ids.has(t.id));
  const out = [];
  for (const target of targets) {
    const pts = [];
    for (const ses of done) for (const tr of ses.trackers) {
      if (tr.targetId === target.id) pts.push({ ses, sum: summarize(tr, ses) });
    }
    if (!pts.length) continue;
    const multi = target.type === "dbr";
    const first = pts[0].sum.metrics[0];
    const items = multi
      ? DBR_ITEMS.map((it, k) => ({ key: it.key, label: it.label, color: COLORS[`s${k + 1}`] }))
      : [{ key: first?.key, label: first?.label || "Value", color: COLORS.s0 }];
    const unit = multi ? "/10" : first?.unit || "";
    const yMax = multi ? 10 : unit === "%" ? 100 : target.type === "rating" ? (target.config?.ratingMax || 5) : null;
    const phases = phasesFor(client, target);
    const segOf = (t) => { let k = 0; phases.forEach((p, i) => { if (t >= p.t) k = i + 1; }); return k; };
    const rows = pts.map((p, i) => ({
      n: i + 1, date: p.ses.startedAt, sessionId: p.ses.id, inFile: inFile.has(p.ses.id), seg: segOf(p.ses.startedAt),
      vals: Object.fromEntries(items.map((it) => [it.key, p.sum.metrics.find((m) => m.key === it.key)?.value ?? null])),
    }));
    const segName = (k) => (k === 0 ? (phases.length ? `Before ${phases[0].name}` : null) : phases[k - 1].name);
    const segments = [...new Set(rows.map((r) => r.seg))].map((k) => ({ k, name: segName(k) }));
    // A phase line sits halfway between the last session before the phase date and the first one on/after it.
    // No line when no session comes before the phase; phases with no sessions between them share one line (last name wins).
    const byX = new Map();
    phases.forEach((p, i) => {
      const firstIn = rows.find((r) => r.seg >= i + 1);
      if (firstIn && firstIn.n > 1) byX.set(firstIn.n - 0.5, p.name);
    });
    const phaseLines = [...byX].map(([x, name]) => ({ name, x }));
    const valMax = Math.max(0, ...rows.flatMap((r) => Object.values(r.vals).filter((v) => v != null)));
    out.push({
      target, unit, items, rows, segments, phaseLines,
      title: target.name,
      subtitle: `${TYPES[target.type].label} · ${multi ? "ratings 0–10" : items[0].label}`,
      yMax: yMax ?? niceMax(valMax * 1.1),
    });
  }
  return out;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// ---------- 2. sheets (ExcelJS) ----------
const colName = (n) => { let s = ""; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const ref = (c, r) => `'${DATA_SHEET}'!$${colName(c)}$${r}`;
const range = (c1, r1, c2, r2) => `'${DATA_SHEET}'!$${colName(c1)}$${r1}:$${colName(c2)}$${r2}`;

// Writes the Graph data sheet and an empty Graphs sheet; returns chart specs (with cell refs and cached values).
export function writeGraphSheets(wb, blocks, { accent = "FF0F766E", muted = "FF5D6A66" } = {}) {
  const gs = wb.getWorksheet(GRAPH_SHEET) || wb.addWorksheet(GRAPH_SHEET, { views: [{ showGridLines: false }] });
  if (!blocks.length) { wb.removeWorksheet(gs.id); return []; }
  gs.getRow(1).getCell(1).value = "Graphs";
  gs.getRow(1).getCell(1).font = { bold: true, size: 16, color: { argb: accent } };
  gs.getRow(2).getCell(1).value = "One graph per target, every session to date. Dashed lines = phase changes. The numbers are on the Graph data sheet; click a graph to edit it.";
  gs.getRow(2).getCell(1).font = { italic: true, color: { argb: muted } };

  const ds = wb.addWorksheet(DATA_SHEET);
  ds.getColumn(1).width = 10;
  ds.getColumn(2).width = 13;
  ds.getColumn(3).width = 11;
  const specs = [];
  let r = 1;
  for (const b of blocks) {
    const top = ds.getRow(r);
    top.getCell(1).value = `${b.title} — ${b.subtitle}`;
    top.getCell(1).font = { bold: true, size: 13, color: { argb: accent } };
    r++;
    // One value column per item × phase segment, so the line breaks at each phase change.
    const cols = [];
    for (const it of b.items) for (const sg of b.segments) {
      const name = [b.items.length > 1 ? it.label : (b.segments.length > 1 ? null : b.title), sg.name].filter(Boolean).join(" · ") || it.label;
      cols.push({ it, sg, name });
    }
    const head = ds.getRow(r);
    ["Session", "Date", "In this file", ...cols.map((c) => c.name)].forEach((v, i) => {
      const cell = head.getCell(i + 1);
      cell.value = v;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: accent } };
    });
    const headRow = r;
    cols.forEach((_, i) => { const c = ds.getColumn(4 + i); c.width = Math.max(c.width || 0, 14); });
    r++;
    const first = r;
    for (const row of b.rows) {
      const R = ds.getRow(r);
      R.getCell(1).value = row.n;
      R.getCell(2).value = isoDate(row.date);
      R.getCell(3).value = row.inFile ? "✓" : "";
      cols.forEach((c, i) => {
        const v = row.seg === c.sg.k ? row.vals[c.it.key] : null;
        if (v != null) R.getCell(4 + i).value = v;
      });
      r++;
    }
    const lastRow = r - 1;
    r++;
    const lines = [];
    if (b.phaseLines.length) {
      const ph = ds.getRow(r);
      ["Phase line", "x", "x", "y from", "y to"].forEach((v, i) => { ph.getCell(i + 1).value = v; ph.getCell(i + 1).font = { bold: true, color: { argb: muted } }; });
      r++;
      for (const pl of b.phaseLines) {
        const R = ds.getRow(r);
        [pl.name, pl.x, pl.x, 0, b.yMax].forEach((v, i) => { R.getCell(i + 1).value = v; });
        lines.push({ name: pl.name, nameRef: ref(0, r), x: range(1, r, 2, r), y: range(3, r, 4, r), xs: [pl.x, pl.x], ys: [0, b.yMax] });
        r++;
      }
    }
    r += 2;
    specs.push({
      title: b.title, subtitle: b.subtitle, yMax: b.yMax, unit: b.unit, n: b.rows.length,
      legend: b.items.length > 1,
      series: cols.map((c, i) => ({
        name: c.name, nameRef: ref(3 + i, headRow), color: c.it.color, itemKey: c.it.key,
        x: range(0, first, 0, lastRow), y: range(3 + i, first, 3 + i, lastRow),
        xs: b.rows.map((row) => row.n), ys: b.rows.map((row) => (row.seg === c.sg.k ? row.vals[c.it.key] : null)),
      })),
      lines,
    });
  }
  return specs;
}

// ---------- 3. chart XML (JSZip) ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const numCache = (vals) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${
  vals.map((v, i) => (v == null ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join("")}</c:numCache>`;
const tx = (f, name) => `<c:tx><c:strRef><c:f>${esc(f)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`;
const txt = (size, bold = false, color = "3B4744") =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
const richTitle = (text, size = 1000, bold = false, sub = null) =>
  `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="15201D"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p>${
    sub ? `<a:p><a:r><a:rPr lang="en-US" sz="900" b="0"><a:solidFill><a:srgbClr val="5F6D69"/></a:solidFill></a:rPr><a:t>${esc(sub)}</a:t></a:r></a:p>` : ""
  }</c:rich></c:tx><c:overlay val="0"/></c:title>`;

function chartXml(spec) {
  const series = [];
  let idx = 0;
  const hideInLegend = [];
  const seenItems = new Set();
  for (const s of spec.series) {
    if (!spec.legend || seenItems.has(s.itemKey)) hideInLegend.push(idx);
    seenItems.add(s.itemKey);
    series.push(`<c:ser><c:idx val="${idx}"/><c:order val="${idx}"/>${tx(s.nameRef, s.name)}
<c:spPr><a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:round/></a:ln></c:spPr>
<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>
<c:xVal><c:numRef><c:f>${esc(s.x)}</c:f>${numCache(s.xs)}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>${esc(s.y)}</c:f>${numCache(s.ys)}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`);
    idx++;
  }
  for (const l of spec.lines) {
    hideInLegend.push(idx);
    series.push(`<c:ser><c:idx val="${idx}"/><c:order val="${idx}"/>${tx(l.nameRef, l.name)}
<c:spPr><a:ln w="15875"><a:solidFill><a:srgbClr val="${PHASE_COLOR}"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr>
<c:marker><c:symbol val="none"/></c:marker>
<c:dLbls><c:dLbl><c:idx val="1"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txt(900, true, "3B4744")}<c:dLblPos val="r"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="1"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbl><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>
<c:xVal><c:numRef><c:f>${esc(l.x)}</c:f>${numCache(l.xs)}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>${esc(l.y)}</c:f>${numCache(l.ys)}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`);
    idx++;
  }
  const n = spec.n;
  const xStep = n <= 15 ? 1 : n <= 30 ? 2 : n <= 75 ? 5 : 10;
  const gridLn = `<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E8ECEA"/></a:solidFill></a:ln></c:spPr>`;
  const axisLn = `<c:spPr><a:noFill/><a:ln w="9525"><a:solidFill><a:srgbClr val="9AA6A2"/></a:solidFill></a:ln></c:spPr>`;
  const yLabel = spec.unit === "%" ? "Percent" : spec.unit === "/10" ? "Rating (0–10)" : spec.subtitle.split(" · ").at(-1);
  const legend = hideInLegend.length < idx
    ? `<c:legend><c:legendPos val="b"/>${hideInLegend.map((i) => `<c:legendEntry><c:idx val="${i}"/><c:delete val="1"/></c:legendEntry>`).join("")}<c:overlay val="0"/>${txt(900)}</c:legend>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/>
<c:chart>${richTitle(spec.title, 1300, true, spec.subtitle)}<c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/><c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>
${series.join("\n")}
<c:axId val="500100"/><c:axId val="500200"/></c:scatterChart>
<c:valAx><c:axId val="500100"/><c:scaling><c:orientation val="minMax"/><c:max val="${n + 1}"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${richTitle("Session")}<c:numFmt formatCode="0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisLn}${txt(900)}<c:crossAx val="500200"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/><c:majorUnit val="${xStep}"/></c:valAx>
<c:valAx><c:axId val="500200"/><c:scaling><c:orientation val="minMax"/><c:max val="${spec.yMax}"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines>${gridLn}</c:majorGridlines>${richTitle(yLabel)}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisLn}${txt(900)}<c:crossAx val="500100"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>
<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>
${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>
<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="DFE3DF"/></a:solidFill></a:ln></c:spPr>
</c:chartSpace>`;
}

function drawingXml(count, { cols = 10, rows = 20, top = 3 } = {}) {
  const anchors = Array.from({ length: count }, (_, i) => {
    const r0 = top + i * (rows + 1);
    return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0 + rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}" xmlns:r="${NS_R}">${anchors.join("")}</xdr:wsDr>`;
}

const rels = (items) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join("")}</Relationships>`;

// Finds the worksheet file behind a sheet name via workbook.xml + its rels.
async function sheetPath(zip, name) {
  const wbXml = await zip.file("xl/workbook.xml").async("string");
  const m = [...wbXml.matchAll(/<sheet\b[^>]*>/g)].map((x) => x[0]).find((tag) => tag.includes(`name="${esc(name)}"`));
  const rid = m?.match(/r:id="([^"]+)"/)?.[1];
  const relXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const rel = [...relXml.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]).find((tag) => tag.includes(`Id="${rid}"`));
  const target = rel?.match(/Target="([^"]+)"/)?.[1];
  if (!target) throw new Error(`Sheet ${name} not found`);
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

// buffer: the ExcelJS output. Returns a new ArrayBuffer with the charts added.
export async function addCharts(buffer, specs, JSZip) {
  if (!specs.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const path = await sheetPath(zip, GRAPH_SHEET);
  const file = path.split("/").pop();
  const dir = path.slice(0, -file.length);
  const free = (fmt) => { let k = 1; while (zip.file(fmt(k))) k++; return k; };
  const d = free((k) => `xl/drawings/drawing${k}.xml`);
  const chartNums = [];
  for (const spec of specs) {
    const k = free((j) => `xl/charts/chart${j}.xml`);
    zip.file(`xl/charts/chart${k}.xml`, chartXml(spec));
    chartNums.push(k);
  }
  zip.file(`xl/drawings/drawing${d}.xml`, drawingXml(specs.length));
  zip.file(`xl/drawings/_rels/drawing${d}.xml.rels`, rels(chartNums.map((k, i) => [`rId${i + 1}`, "chart", `../charts/chart${k}.xml`])));

  // Sheet → drawing relationship (merge into an existing rels file if ExcelJS wrote one).
  const relPath = `${dir}_rels/${file}.rels`;
  const drawRel = `<Relationship Id="rIdCharts1" Type="${REL}/drawing" Target="../drawings/drawing${d}.xml"/>`;
  const existing = zip.file(relPath) ? await zip.file(relPath).async("string") : null;
  zip.file(relPath, existing ? existing.replace("</Relationships>", `${drawRel}</Relationships>`) : rels([["rIdCharts1", "drawing", `../drawings/drawing${d}.xml`]]));

  let sx = await zip.file(path).async("string");
  if (!/xmlns:r=/.test(sx.match(/<worksheet\b[^>]*>/)[0])) sx = sx.replace(/<worksheet\b/, `<worksheet xmlns:r="${NS_R}"`);
  const tag = `<drawing r:id="rIdCharts1"/>`;
  const after = sx.search(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/);
  sx = after >= 0 ? sx.slice(0, after) + tag + sx.slice(after) : sx.replace("</worksheet>", `${tag}</worksheet>`);
  zip.file(path, sx);

  let ct = await zip.file("[Content_Types].xml").async("string");
  const over = [`<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    ...chartNums.map((k) => `<Override PartName="/xl/charts/chart${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`)];
  ct = ct.replace("</Types>", `${over.join("")}</Types>`);
  zip.file("[Content_Types].xml", ct);
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}
