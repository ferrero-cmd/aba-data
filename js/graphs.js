// Phase 2: graphs for one client. Hand-drawn SVG so phase-change lines and broken data paths follow ABA conventions.
import { DBR_ITEMS, parseOption, TYPES, uid } from "./model.js";
import { eventsByPeriod, fmtDate, isoDate, periodExposure, round, summarize, supportsScatter } from "./summary.js";
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
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

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
    const scatterTargets = targets.filter((t) => supportsScatter(t.type));
    if (scatterTargets.length && sessions.some((x) => (x.periodLog || []).length)) content.append(scatterCard(scatterTargets, sessions, settings));
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

  const tMin = Math.min(...all.map((p) => p.t), ...phases.map((p) => p.t));
  const tMax = Math.max(...all.map((p) => p.t));
  const span = Math.max(tMax - tMin, DAY * 6);
  const t0 = tMin - span * 0.04;
  const t1 = tMin + span * 1.04;
  const top = yMax ?? niceMax(Math.max(...all.map((p) => p.v)) * 1.1);
  const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
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
  // x ticks: up to 5 dates
  const nx = Math.min(5, Math.max(2, Math.round((W - 80) / 90)));
  for (let i = 0; i < nx; i++) {
    const t = tMin + ((tMax - tMin) * i) / Math.max(1, nx - 1);
    if (tMax === tMin && i) break;
    svgEl.append(s("text", { x: x(t), y: H - 8, class: "tick", "text-anchor": i === 0 && tMax !== tMin ? "start" : i === nx - 1 ? "end" : "middle" },
      new Date(t).toLocaleDateString([], { month: "short", day: "numeric" })));
  }

  // phase-change lines (dashed, labelled) — ABA convention
  const bounds = [-Infinity, ...phases.map((p) => p.t), Infinity];
  phases.forEach((p, i) => {
    const px = x(p.t);
    svgEl.append(s("line", { x1: px, x2: px, y1: pad.t - 8, y2: H - pad.b, class: "phase-line" }));
    const next = phases[i + 1] ? x(phases[i + 1].t) : W - pad.r;
    svgEl.append(s("text", { x: px + 4, y: pad.t - 12, class: "phase-label" }, truncate(p.name, Math.max(4, Math.floor((next - px) / 7)))));
  });
  const phaseIndex = (t) => { let k = 0; for (let i = 1; i < bounds.length; i++) if (t >= bounds[i]) k = i; return k; };

  // series: separate path per phase (no line connecting across a phase change)
  for (const sr of series) {
    const pts = sr.pts.filter((p) => p.v != null);
    const groups = new Map();
    for (const p of pts) { const k = phaseIndex(p.t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    for (const g of groups.values()) {
      if (g.length > 1) svgEl.append(s("path", { d: g.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${y(p.v)}`).join(""), class: `line ${sr.cls}` }));
      if (trend && g.length > 2) {
        const n = g.length;
        const xs = g.map((p) => p.t);
        const ys = g.map((p) => p.v);
        const mx = xs.reduce((a, b) => a + b, 0) / n;
        const my = ys.reduce((a, b) => a + b, 0) / n;
        const sl = xs.reduce((a, xx, i) => a + (xx - mx) * (ys[i] - my), 0) / (xs.reduce((a, xx) => a + (xx - mx) ** 2, 0) || 1);
        const yv = (t) => Math.max(0, Math.min(top, my + sl * (t - mx)));
        svgEl.append(s("line", { x1: x(xs[0]), y1: y(yv(xs[0])), x2: x(xs[n - 1]), y2: y(yv(xs[n - 1])), class: `trend ${sr.cls}` }));
      }
    }
    for (const p of pts) svgEl.append(s("circle", { cx: x(p.t), cy: y(p.v), r: 4.5, class: `dot ${sr.cls}` }));
  }

  // hover / tap layer: nearest session → tooltip with Open
  const cursor = s("line", { y1: pad.t, y2: H - pad.b, class: "cursor", visibility: "hidden" });
  svgEl.append(cursor);
  const tip = h("div", { class: "chart-tip", hidden: true });
  const sessionsX = [...new Map(all.map((p) => [p.sessionId, p])).values()];
  const pick = (clientX) => {
    const r = svgEl.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = sessionsX[0];
    for (const p of sessionsX) if (Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px)) best = p;
    return best;
  };
  const show = (p) => {
    cursor.setAttribute("x1", x(p.t)); cursor.setAttribute("x2", x(p.t)); cursor.setAttribute("visibility", "visible");
    const rows = series.map((sr) => [sr, sr.pts.find((q) => q.sessionId === p.sessionId)?.v]);
    tip.replaceChildren(h("div", { class: "tip-date" }, fmtDate(p.t)),
      ...rows.map(([sr, v]) => h("div", { class: "tip-row" }, series.length > 1 ? h("i", { class: `key ${sr.cls}` }) : null,
        series.length > 1 ? h("span", { class: "muted" }, `${sr.name.split(" ")[0]} `) : null, h("b", {}, v == null ? "—" : `${v}${unit}`))),
      h("button", { class: "tip-open", onclick: () => onOpen(p.sessionId) }, "Open session ›"));
    tip.hidden = false;
    const left = (x(p.t) / W) * 100;
    tip.style.left = `${Math.min(78, Math.max(2, left - 12))}%`;
  };
  svgEl.addEventListener("pointermove", (ev) => { if (ev.pointerType === "mouse") show(pick(ev.clientX)); });
  svgEl.addEventListener("pointerdown", (ev) => show(pick(ev.clientX)));
  svgEl.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") { cursor.setAttribute("visibility", "hidden"); tip.hidden = true; } });

  box.append(svgEl, tip);
  return box;
}

const truncate = (str, n) => (str.length > n ? `${str.slice(0, Math.max(1, n - 1))}…` : str);

// ---------- scatterplot (period × weekday heat grid) ----------
function scatterCard(targets, sessions, settings) {
  let targetId = targets[0].id;
  const box = h("div", {});
  const draw = () => {
    const t = targets.find((x) => x.id === targetId);
    const count = {};
    const expo = {};
    for (const ses of sessions) {
      const wd = (new Date(ses.startedAt).getDay() + 6) % 7; // Mon = 0
      if (wd > 4) continue;
      const ex = periodExposure(ses);
      for (const [p, ms] of Object.entries(ex)) expo[`${p}|${wd}`] = (expo[`${p}|${wd}`] || 0) + ms;
      for (const tr of ses.trackers) {
        if (tr.targetId !== t.id) continue;
        for (const [p, n] of Object.entries(eventsByPeriod(tr, ses))) count[`${p}|${wd}`] = (count[`${p}|${wd}`] || 0) + n;
      }
    }
    const seen = new Set(Object.keys(expo).map((k) => k.split("|")[0]));
    const periods = [...settings.periods.filter((p) => seen.has(p)), ...[...seen].filter((p) => !settings.periods.includes(p))];
    const isDur = t.type === "duration";
    const val = (k) => {
      if (!expo[k]) return null;
      const hrs = expo[k] / 3600000;
      return isDur ? round((100 * (count[k] || 0)) / (expo[k] / 60000)) : round((count[k] || 0) / hrs);
    };
    const vals = periods.flatMap((p) => WEEKDAYS.map((_, d) => val(`${p}|${d}`))).filter((v) => v != null);
    const max = Math.max(...vals, 0.0001);
    const step = (v) => (v == null ? "none" : v === 0 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 4.999)));
    box.replaceChildren(
      periods.length ? h("div", { class: "heat", style: { "--cols": WEEKDAYS.length } },
        h("div", {}), ...WEEKDAYS.map((d) => h("div", { class: "heat-col" }, d)),
        ...periods.flatMap((p) => [h("div", { class: "heat-row" }, p), ...WEEKDAYS.map((d, i) => {
          const v = val(`${p}|${i}`);
          return h("div", { class: `heat-cell q${step(v)}`, title: v == null ? `${p} ${d}: not observed` : `${p} ${d}: ${v}${isDur ? "% of time" : " per hour"}` },
            v == null ? "" : String(v));
        })]))
        : h("p", { class: "muted small" }, "Tag periods during sessions to see when behavior happens."),
      h("div", { class: "heat-legend small muted" }, h("span", {}, isDur ? "% of observed time" : "Per hour of observation"),
        h("span", { class: "heat-scale" }, ...[0, 1, 2, 3, 4, 5].map((q) => h("i", { class: `heat-cell q${q}` }))), h("span", {}, "Blank = not observed")));
  };
  draw();
  return h("section", { class: "card graph-card" },
    h("div", { class: "graph-title" }, h("div", { class: "grow" }, h("h3", {}, "Scatterplot by period"),
      h("div", { class: "muted small" }, "When does the behavior happen? Stronger colour = more."))),
    targets.length > 1 ? h("div", { class: "chips scroll" }, ...targets.map((t) => {
      const b = h("button", { class: `chip small ${t.id === targetId ? "on" : ""}`, onclick: () => {
        targetId = t.id; b.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b)); draw();
      } }, t.name);
      return b;
    })) : null,
    box);
}

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

