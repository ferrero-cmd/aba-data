// Phase 2: graphs for one client. Hand-drawn SVG so phase-change lines and broken data paths follow ABA conventions.
import { DBR_ITEMS, parseOption, TYPES, uid } from "./model.js";
import { fmtDate, isoDate, round, summarize } from "./summary.js";
import { h, segmented, sheet, toast, confirmSheet } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};

const RANGES = [["1m", "1 mo", 31], ["3m", "3 mo", 92], ["6m", "6 mo", 183], ["all", "All", Infinity]];
const DAY = 86400000;

export async function graphsTab(client, allSessions, { go, settings, save }) {
  const done = allSessions.filter((x) => x.status === "done").sort((a, b) => a.startedAt - b.startedAt);
  const wrap = h("div", { class: "graphs" });
  let range = "all";
  const content = h("div", {});

  if (!done.length) {
    wrap.append(h("div", { class: "empty-state small" }, h("p", { class: "muted" }, "Graphs appear here after the first finished session.")));
    return wrap;
  }

  const draw = () => {
    const days = RANGES.find((r) => r[0] === range)[2];
    const from = days === Infinity ? 0 : Date.now() - days * DAY;
    const sessions = done.filter((x) => x.startedAt >= from);
    content.replaceChildren();
    if (!sessions.length) { content.append(h("p", { class: "muted center" }, "No sessions in this range.")); return; }
    const targets = client.targets.filter((t) => sessions.some((x) => x.trackers.some((tr) => tr.targetId === t.id)));
    for (const t of targets) content.append(targetCard(client, t, sessions, go));
    const abcRows = sessions.flatMap((x) => x.trackers.filter((tr) => tr.type === "abc").flatMap((tr) => tr.events.filter((ev) => ev.k === "abc")));
    if (abcRows.length) content.append(abcCard(abcRows, settings));
  };

  wrap.append(
    h("div", { class: "graph-filters" },
      segmented(RANGES.map(([k, l]) => [k, l]), range, (v) => { range = v; draw(); }, "small"),
      h("button", { class: "btn small", onclick: () => phasesSheet(client, save, () => draw()) }, "Phases")),
    content);
  draw();
  // Redraw on rotation / resize so the charts fit the width.
  let rt;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (wrap.isConnected) draw(); else removeEventListener("resize", onResize); }, 200); };
  addEventListener("resize", onResize);
  return wrap;
}

// ---------- data ----------
function seriesFor(target, sessions) {
  const pts = [];
  for (const ses of sessions) {
    for (const tr of ses.trackers) {
      if (tr.targetId !== target.id) continue;
      pts.push({ t: ses.startedAt, sessionId: ses.id, sum: summarize(tr, ses) });
    }
  }
  return pts;
}

function phasesFor(client, target) {
  return (client.phases || [])
    .filter((p) => !p.targetIds?.length || p.targetIds.includes(target.id))
    .map((p) => ({ ...p, t: new Date(`${p.date}T00:00:00`).getTime() }))
    .sort((a, b) => a.t - b.t);
}

// ---------- one target ----------
function targetCard(client, target, sessions, go) {
  const pts = seriesFor(target, sessions);
  const metrics = pts[0]?.sum.metrics || [];
  const multi = target.type === "dbr";
  let metricKey = metrics[0]?.key;
  let trend = false;
  const chartBox = h("div", { class: "chart-box" });
  const statRow = h("div", { class: "stat-row" });
  const table = h("div", { class: "table-wrap" });

  const draw = () => {
    const phases = phasesFor(client, target);
    const series = multi
      ? DBR_ITEMS.map((it, k) => ({ name: it.label, cls: `s${k + 1}`, pts: pts.map((p) => ({ ...p, v: p.sum.metrics.find((m) => m.key === it.key)?.value })) }))
      : [{ name: target.name, cls: "s0", pts: pts.map((p) => ({ ...p, v: p.sum.metrics.find((m) => m.key === metricKey)?.value })) }];
    const m = metrics.find((x) => x.key === metricKey) || metrics[0];
    const unit = multi ? "/10" : m?.unit || "";
    const yMax = multi ? 10 : unit === "%" ? 100 : target.type === "rating" ? (target.config?.ratingMax || 5) : null;
    chartBox.replaceChildren(lineChart({ series, phases, yMax, unit, trend, onOpen: (id) => go(`#/r/${id}`) }));
    if (multi) {
      chartBox.append(h("div", { class: "legend" }, ...series.map((sr) => h("span", { class: "legend-item" }, h("i", { class: `key ${sr.cls}` }), sr.name))));
    }

    // Latest value and this phase's mean
    if (!multi) {
      const vals = series[0].pts.filter((p) => p.v != null);
      const last = vals.at(-1);
      const curPhase = phases.filter((p) => p.t <= Date.now()).at(-1);
      const inPhase = curPhase ? vals.filter((p) => p.t >= curPhase.t) : vals;
      const avg = inPhase.length ? round(inPhase.reduce((a, p) => a + p.v, 0) / inPhase.length) : null;
      statRow.replaceChildren(
        stat("Latest", last ? `${last.v}${unit}` : "—", last ? new Date(last.t).toLocaleDateString([], { month: "short", day: "numeric" }) : ""),
        stat(curPhase ? `${curPhase.name} mean` : "Mean", avg == null ? "—" : `${avg}${unit}`, `${inPhase.length} session${inPhase.length === 1 ? "" : "s"}`),
        stat("Sessions", vals.length, ""));
    } else statRow.replaceChildren();

    table.replaceChildren(h("details", {}, h("summary", {}, "Show data table"),
      h("table", { class: "data-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Date"), ...series.map((sr) => h("th", {}, multi ? sr.name.split(" ")[0] : m?.label || "Value")))),
        h("tbody", {}, ...pts.map((p, i) => h("tr", {}, h("td", {}, fmtDate(p.t)), ...series.map((sr) => h("td", {}, sr.pts[i].v ?? "—"))))))));
  };

  const controls = h("div", { class: "card-controls" },
    !multi && metrics.length > 1 ? h("div", { class: "chips scroll" }, ...metrics.map((mm) => {
      const b = h("button", { class: `chip small ${mm.key === metricKey ? "on" : ""}`, onclick: () => {
        metricKey = mm.key; controls.querySelectorAll(".chips .chip").forEach((c) => c.classList.toggle("on", c === b)); draw();
      } }, mm.label);
      return b;
    })) : null,
    h("label", { class: "toggle small" }, h("input", { type: "checkbox", onchange: (ev) => { trend = ev.target.checked; draw(); } }), "Trend lines"));

  draw();
  return h("section", { class: "card graph-card" },
    h("div", { class: "graph-title" }, h("span", { class: `type-dot t-${target.type}` }), h("div", { class: "grow" },
      h("h3", {}, target.name), h("div", { class: "muted small" }, TYPES[target.type].label + (target.archived ? " · archived" : "")))),
    statRow, controls, chartBox, table);
}

const stat = (label, value, sub) => h("div", { class: "stat" }, h("div", { class: "stat-label" }, label), h("div", { class: "stat-value" }, value), sub ? h("div", { class: "stat-sub" }, sub) : null);

// ---------- line chart ----------
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function lineChart({ series, phases, yMax, unit, trend, onOpen }) {
  const W = Math.max(300, Math.min(720, (document.querySelector(".view")?.clientWidth || 360) - 34));
  const H = 220;
  const pad = { l: 38, r: 12, t: phases.length ? 26 : 12, b: 28 };
  const all = series.flatMap((sr) => sr.pts.filter((p) => p.v != null));
  const box = h("div", { class: "chart" });
  if (!all.length) { box.append(h("p", { class: "muted small center" }, "No values for this measure yet.")); return box; }

  // x axis = sessions in date order, evenly spaced (ABA session-by-session convention). Same-day
  // sessions get their own slot instead of piling up on one date.
  const sess = [...new Map([...all].sort((a, b) => a.t - b.t).map((p) => [p.sessionId, p])).values()];
  const idx = new Map(sess.map((p, i) => [p.sessionId, i]));
  const n = sess.length;
  const slot = (W - pad.l - pad.r) / n;
  const xi = (i) => pad.l + slot * (i + 0.5);
  const xp = (p) => xi(idx.get(p.sessionId));
  const boundary = (t) => { const k = sess.findIndex((p) => p.t >= t); return pad.l + slot * (k < 0 ? n : k); };
  const top = yMax ?? niceMax(Math.max(...all.map((p) => p.v)) * 1.1);
  const y = (v) => pad.t + (1 - v / top) * (H - pad.t - pad.b);

  const svgEl = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "chart-svg", role: "img" });

  // grid + y ticks
  const lead = top / 10 ** Math.floor(Math.log10(top));
  const ticks = Math.abs(lead - 2) < 1e-9 ? 4 : 5; // 0–20 by 5s, 0–25 by 5s, 0–100 by 20s
  for (let i = 0; i <= ticks; i++) {
    const v = (top / ticks) * i;
    svgEl.append(s("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: i ? "grid" : "axis" }),
      s("text", { x: pad.l - 6, y: y(v) + 4, class: "tick", "text-anchor": "end" }, `${round(v, v < 10 && top < 10 ? 1 : 0)}${i === ticks && unit === "%" ? "%" : ""}`));
  }
  // x: a small mark per session; a date label on the first session of each day, skipped if it would collide
  let lastX = -Infinity;
  let lastDay = null;
  sess.forEach((p, i) => {
    const px = xi(i);
    svgEl.append(s("line", { x1: px, x2: px, y1: H - pad.b, y2: H - pad.b + 4, class: "axis" }));
    const day = isoDate(p.t);
    if (day === lastDay) return;
    lastDay = day;
    if (px - lastX < 54) return;
    lastX = px;
    svgEl.append(s("text", { x: Math.min(W - 22, Math.max(22, px)), y: H - 8, class: "tick", "text-anchor": "middle" },
      new Date(p.t).toLocaleDateString([], { month: "short", day: "numeric" })));
  });

  // phase-change lines (dashed, labelled) between the last session before and the first on/after the date
  const bounds = [-Infinity, ...phases.map((p) => p.t), Infinity];
  phases.forEach((p, i) => {
    const px = boundary(p.t);
    svgEl.append(s("line", { x1: px, x2: px, y1: pad.t - 8, y2: H - pad.b, class: "phase-line" }));
    const next = phases[i + 1] ? boundary(phases[i + 1].t) : W - pad.r;
    svgEl.append(s("text", { x: px + 4, y: pad.t - 12, class: "phase-label" }, truncate(p.name, Math.max(4, Math.floor((next - px) / 7)))));
  });
  const phaseIndex = (t) => { let k = 0; for (let i = 1; i < bounds.length; i++) if (t >= bounds[i]) k = i; return k; };

  // series: separate path per phase (no line connecting across a phase change)
  const dots = new Map(); // sessionId → circles
  for (const sr of series) {
    const pts = sr.pts.filter((p) => p.v != null);
    const groups = new Map();
    for (const p of pts) { const k = phaseIndex(p.t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    for (const g of groups.values()) {
      if (g.length > 1) svgEl.append(s("path", { d: g.map((p, i) => `${i ? "L" : "M"}${xp(p)},${y(p.v)}`).join(""), class: `line ${sr.cls}` }));
      if (trend && g.length > 2) {
        const m = g.length;
        const xs = g.map((p) => idx.get(p.sessionId));
        const ys = g.map((p) => p.v);
        const mx = xs.reduce((a, b) => a + b, 0) / m;
        const my = ys.reduce((a, b) => a + b, 0) / m;
        const sl = xs.reduce((a, xx, i) => a + (xx - mx) * (ys[i] - my), 0) / (xs.reduce((a, xx) => a + (xx - mx) ** 2, 0) || 1);
        const yv = (k) => Math.max(0, Math.min(top, my + sl * (k - mx)));
        svgEl.append(s("line", { x1: xi(xs[0]), y1: y(yv(xs[0])), x2: xi(xs[m - 1]), y2: y(yv(xs[m - 1])), class: `trend ${sr.cls}` }));
      }
    }
    for (const p of pts) {
      const c = s("circle", { cx: xp(p), cy: y(p.v), r: 4.5, class: `dot ${sr.cls}` });
      if (!dots.has(p.sessionId)) dots.set(p.sessionId, []);
      dots.get(p.sessionId).push(c);
      svgEl.append(c);
    }
  }

  // ---- selection: tap a point → details in a strip under the chart (never covers the graph).
  // Tap it again, tap empty space or anywhere outside the chart to clear. Drag sideways to step through sessions.
  const cursor = s("line", { y1: pad.t, y2: H - pad.b, class: "cursor", visibility: "hidden" });
  svgEl.insertBefore(cursor, svgEl.querySelector("circle"));
  const detail = h("div", { class: "chart-detail" });
  const hm = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  let sel = null;
  const select = (p) => {
    if (sel) for (const c of dots.get(sel.sessionId) || []) { c.setAttribute("r", 4.5); c.classList.remove("on"); }
    sel = p;
    if (!p) {
      cursor.setAttribute("visibility", "hidden");
      detail.classList.remove("on");
      detail.replaceChildren(h("span", { class: "muted" }, "Tap a point for details"));
      return;
    }
    for (const c of dots.get(p.sessionId) || []) { c.setAttribute("r", 7); c.classList.add("on"); }
    cursor.setAttribute("x1", xp(p)); cursor.setAttribute("x2", xp(p)); cursor.setAttribute("visibility", "visible");
    const vals = series.map((sr) => [sr, sr.pts.find((q) => q.sessionId === p.sessionId)?.v]);
    detail.classList.add("on");
    detail.replaceChildren(
      h("div", { class: "grow" },
        h("div", { class: "detail-date" }, `${new Date(p.t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${hm(p.t)}`),
        h("div", { class: "detail-vals" }, ...vals.map(([sr, v]) => h("span", {},
          series.length > 1 ? h("i", { class: `key ${sr.cls}` }) : null,
          series.length > 1 ? `${sr.name.split(" ")[0]} ` : null, h("b", {}, v == null ? "—" : `${v}${unit}`))))),
      h("button", { class: "detail-open", onclick: () => onOpen(p.sessionId) }, "Open ›"));
  };
  select(null);

  const local = (ev) => {
    const r = svgEl.getBoundingClientRect();
    return [((ev.clientX - r.left) / r.width) * W, ((ev.clientY - r.top) / r.height) * H];
  };
  const nearest = (px, py) => {
    let best = null;
    let bd = Infinity;
    for (const p of all) { const d = Math.hypot(xp(p) - px, y(p.v) - py); if (d < bd) { bd = d; best = p; } }
    return [best, bd];
  };
  const nearestByX = (px) => sess[Math.max(0, Math.min(n - 1, Math.floor((px - pad.l) / slot)))];
  let dragging = false;
  svgEl.addEventListener("pointerdown", (ev) => {
    const [px, py] = local(ev);
    const [p, d] = nearest(px, py);
    if (d > Math.max(28, Math.min(44, slot / 2 + 10))) { select(null); return; }
    if (sel && sel.sessionId === p.sessionId) { select(null); return; }
    select(p);
    dragging = true;
  });
  svgEl.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const p = nearestByX(local(ev)[0]);
    if (p && p.sessionId !== sel?.sessionId) select(p);
  });
  for (const t of ["pointerup", "pointercancel", "pointerleave"]) svgEl.addEventListener(t, () => { dragging = false; });
  const outside = (ev) => {
    if (!box.isConnected) { document.removeEventListener("pointerdown", outside, true); return; }
    if (sel && !box.contains(ev.target)) select(null);
  };
  document.addEventListener("pointerdown", outside, true);

  box.append(svgEl, detail);
  return box;
}

const truncate = (str, n) => (str.length > n ? `${str.slice(0, Math.max(1, n - 1))}…` : str);

// ---------- ABC summary ----------
function abcCard(rows, settings) {
  const fnOf = new Map(settings.abcC.map((line) => [parseOption(line).label, parseOption(line).fn]));
  const tally = (key) => {
    const m = new Map();
    for (const r of rows) { const v = key === "c" ? parseOption(r.c || "").label : r[key]; if (v) m.set(v, (m.get(v) || 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 6);
  };
  const fns = new Map();
  for (const r of rows) {
    const opt = parseOption(r.c || "");
    const fn = opt.fn || fnOf.get(opt.label);
    if (fn) fns.set(fn, (fns.get(fn) || 0) + 1);
  }
  const bars = (title, data) => {
    const max = Math.max(...data.map((d) => d[1]), 1);
    return h("div", { class: "bars" }, h("div", { class: "bars-title" }, title),
      data.length ? data.map(([label, n]) => h("div", { class: "bar-row", title: `${label}: ${n}` },
        h("div", { class: "bar-label" }, label),
        h("div", { class: "bar-track" }, h("div", { class: "bar-fill", style: { width: `${(100 * n) / max}%` } })),
        h("div", { class: "bar-n" }, n))) : h("p", { class: "muted small" }, "None recorded"));
  };
  const total = [...fns.values()].reduce((a, b) => a + b, 0);
  const topFn = [...fns].sort((a, b) => b[1] - a[1])[0];
  return h("section", { class: "card graph-card" },
    h("div", { class: "graph-title" }, h("div", { class: "grow" }, h("h3", {}, "ABC summary"), h("div", { class: "muted small" }, `${rows.length} ABC entries`))),
    topFn ? h("div", { class: "fn-hint" },
      h("div", { class: "fn-head" }, "Possible function"),
      h("div", { class: "fn-chips" }, ...[...fns].sort((a, b) => b[1] - a[1]).map(([fn, n]) =>
        h("span", { class: `fn-chip ${fn === topFn[0] ? "top" : ""}` }, `${fn[0].toUpperCase()}${fn.slice(1)} ${Math.round((100 * n) / total)}%`))),
      h("div", { class: "muted small" }, "Based on recorded consequences only — a hint to guide your FBA, not a conclusion.")) : null,
    bars("Antecedents", tally("a")),
    bars("Consequences", tally("c")),
    bars("Behaviors", tally("b")));
}

// ---------- phases editor ----------
function phasesSheet(client, save, onChange) {
  client.phases ??= [];
  const list = h("div", {});
  const draw = () => list.replaceChildren(
    client.phases.length ? h("div", { class: "list-card" }, ...[...client.phases].sort((a, b) => a.date.localeCompare(b.date)).map((p) =>
      h("div", { class: "target-row" }, h("div", { class: "grow" }, h("div", { class: "target-name" }, p.name),
        h("div", { class: "muted small" }, `From ${fmtDate(new Date(`${p.date}T00:00:00`).getTime())} · ${p.targetIds?.length ? client.targets.filter((t) => p.targetIds.includes(t.id)).map((t) => t.name).join(", ") : "All targets"}`)),
        h("button", { class: "icon-btn danger", "aria-label": `Remove ${p.name}`, onclick: async () => {
          if (!(await confirmSheet(`Remove “${p.name}”?`, "Only the phase line is removed; no data is deleted.", "Remove"))) return;
          client.phases = client.phases.filter((x) => x.id !== p.id); await save(); draw(); onChange();
        } }, "Remove"))))
      : h("p", { class: "muted small" }, "No phase lines yet. Add one when you start an intervention (e.g. Baseline → Intervention)."));
  draw();

  const name = h("input", { class: "input", placeholder: "e.g. Baseline, Token board, FCT", maxlength: 30 });
  const date = h("input", { class: "input", type: "date", value: isoDate(Date.now()) });
  const picked = new Set();
  const chips = h("div", { class: "chips wrap" });
  const drawChips = () => chips.replaceChildren(
    h("button", { class: `chip ${picked.size ? "" : "on"}`, type: "button", onclick: () => { picked.clear(); drawChips(); } }, "All targets"),
    ...client.targets.filter((t) => !t.archived).map((t) => h("button", { class: `chip ${picked.has(t.id) ? "on" : ""}`, type: "button",
      onclick: () => { picked.has(t.id) ? picked.delete(t.id) : picked.add(t.id); drawChips(); } }, t.name)));
  drawChips();

  sheet("Phase lines", h("div", { class: "stack" }, list,
    h("div", { class: "group-title tight" }, "Add phase"),
    name, date, chips,
    h("button", { class: "btn big primary", onclick: async () => {
      if (!name.value.trim() || !date.value) { toast("Name and date please"); return; }
      client.phases.push({ id: uid(), name: name.value.trim(), date: date.value, targetIds: [...picked] });
      await save();
      name.value = "";
      picked.clear(); drawChips(); draw(); onChange();
      toast("Phase added");
    } }, "Add phase line")), { className: "tall" });
}

