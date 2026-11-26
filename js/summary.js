// Pure calculations on a session's data, shared by the live screen, the Excel export and the graphs.
// Every event stores t (wall clock ms), e (session ms excluding pauses) and p (class period at that moment).
import { activeMs, DBR_ITEMS, INTERVAL_TYPES, MOMENT_TYPES, parseOption } from "./model.js";

// ---------- formatting ----------
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
export const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
export const fmtDate = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
export const isoDate = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const round = (n, d = 1) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const pct = (a, b) => (b ? round((100 * a) / b) : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const secs = (ms) => round(ms / 1000, 1);

export const sessionMs = (session) => activeMs(session);

// ---------- class periods ----------
export function periodAt(session, e) {
  let p = null;
  for (const entry of session.periodLog || []) if (entry.e <= e) p = entry.name;
  return p;
}

// How long the session spent in each period: { Math: ms, Recess: ms }.
export function periodExposure(session) {
  const log = session.periodLog || [];
  const end = sessionMs(session);
  const out = {};
  log.forEach((entry, i) => {
    const until = i + 1 < log.length ? log[i + 1].e : end;
    if (!entry.name) return;
    out[entry.name] = (out[entry.name] || 0) + Math.max(0, until - entry.e);
  });
  return out;
}

// ---------- intervals ----------
export function intervalInfo(tr, e) {
  const L = Math.max(1, (tr.config?.intervalSec || 10)) * 1000;
  const count = tr.config?.intervalCount || 0;
  let completed = Math.floor(e / L);
  if (count) completed = Math.min(completed, count);
  const finished = count > 0 && completed >= count;
  const current = finished ? null : Math.floor(e / L);
  const remaining = finished ? 0 : L - (e % L);
  return { L, count, completed, current, finished, remaining };
}

// Result of interval i for a finished interval, or null if it wasn't scored.
function intervalResult(tr, i) {
  const v = tr.iv?.[i];
  switch (tr.type) {
    case "pir": return v === 1 ? 1 : 0; // marked = occurred
    case "wir": return v === 0 ? 0 : 1; // marked = broken
    default: return v ?? null; // moment types: value recorded at the end of the interval
  }
}

// ---------- duration / latency pairing ----------
function durationEpisodes(tr, endE) {
  const eps = [];
  let open = null;
  for (const ev of tr.events) {
    if (ev.k === "start") open = ev;
    else if (ev.k === "stop" && open) { eps.push({ start: open, stop: ev, ms: ev.e - open.e }); open = null; }
  }
  if (open) eps.push({ start: open, stop: null, ms: Math.max(0, endE - open.e), running: true });
  return eps;
}

function latencyTrials(tr) {
  const trials = [];
  let open = null;
  for (const ev of tr.events) {
    if (ev.k === "sd") { if (open) trials.push({ sd: open, resp: null }); open = ev; }
    else if ((ev.k === "resp" || ev.k === "noresp") && open) {
      trials.push({ sd: open, resp: ev.k === "resp" ? ev : null, none: ev.k === "noresp", end: ev });
      open = null;
    }
  }
  if (open) trials.push({ sd: open, resp: null, pending: true });
  return trials;
}

export const latencyOpen = (tr) => {
  const last = [...tr.events].reverse().find((ev) => ["sd", "resp", "noresp"].includes(ev.k));
  return last?.k === "sd" ? last : null;
};
export const durationOpen = (tr) => {
  const last = [...tr.events].reverse().find((ev) => ev.k === "start" || ev.k === "stop");
  return last?.k === "start" ? last : null;
};

// ---------- summary ----------
// Returns { headline, metrics: [{ key, label, value, unit }], details: [[label, value]] }.
// The first metric is what the graphs show by default.
export function summarize(tr, session, e = sessionMs(session)) {
  const min = e / 60000;
  const ev = tr.events || [];
  switch (tr.type) {
    case "frequency": {
      const taps = ev.filter((x) => x.k === "tap");
      const irts = taps.slice(1).map((x, i) => (x.e - taps[i].e) / 1000);
      const rateMin = min > 0 ? taps.length / min : null;
      return {
        headline: `${taps.length} ${taps.length === 1 ? "time" : "times"}`,
        metrics: [
          { key: "rateHr", label: "Rate per hour", value: round(rateMin * 60), unit: "/hr" },
          { key: "count", label: "Count", value: taps.length, unit: "" },
          { key: "rateMin", label: "Rate per minute", value: round(rateMin, 2), unit: "/min" },
          { key: "irt", label: "Mean IRT", value: round(mean(irts)), unit: "s" },
        ],
        details: [["Count", taps.length], ["Rate", rateMin == null ? "—" : `${round(rateMin, 2)}/min · ${round(rateMin * 60)}/hr`],
          ["Mean IRT", irts.length ? `${round(mean(irts))} s` : "—"], ["Median IRT", irts.length ? `${round(median(irts))} s` : "—"]],
      };
    }
    case "duration": {
      const eps = durationEpisodes(tr, e);
      const total = eps.reduce((a, x) => a + x.ms, 0);
      const meanEp = eps.length ? total / eps.length : null;
      return {
        headline: `${fmtClock(total)} total`,
        metrics: [
          { key: "pct", label: "% of session", value: e ? pct(total, e) : null, unit: "%" },
          { key: "totalMin", label: "Total minutes", value: round(total / 60000, 2), unit: "min" },
          { key: "episodes", label: "Episodes", value: eps.length, unit: "" },
          { key: "meanSec", label: "Mean episode", value: meanEp == null ? null : secs(meanEp), unit: "s" },
        ],
        details: [["Total", fmtClock(total)], ["% of session", e ? `${pct(total, e)}%` : "—"], ["Episodes", eps.length],
          ["Mean episode", meanEp == null ? "—" : fmtClock(meanEp)], ["Longest", eps.length ? fmtClock(Math.max(...eps.map((x) => x.ms))) : "—"]],
      };
    }
    case "latency": {
      const trials = latencyTrials(tr).filter((x) => !x.pending);
      const lats = trials.filter((x) => x.resp).map((x) => (x.resp.e - x.sd.e) / 1000);
      const none = trials.filter((x) => x.none).length;
      return {
        headline: lats.length ? `${round(mean(lats))} s mean` : `${trials.length} trials`,
        metrics: [
          { key: "mean", label: "Mean latency", value: round(mean(lats)), unit: "s" },
          { key: "median", label: "Median latency", value: round(median(lats)), unit: "s" },
          { key: "trials", label: "Trials", value: trials.length, unit: "" },
        ],
        details: [["Trials", trials.length], ["Responded", lats.length], ["No response", none],
          ["Mean", lats.length ? `${round(mean(lats))} s` : "—"], ["Median", lats.length ? `${round(median(lats))} s` : "—"],
          ["Range", lats.length ? `${round(Math.min(...lats))}–${round(Math.max(...lats))} s` : "—"]],
      };
    }
    case "pir":
    case "wir":
    case "mts": {
      const { completed } = intervalInfo(tr, e);
      const results = [];
      for (let i = 0; i < completed; i++) results.push(intervalResult(tr, i));
      const scored = results.filter((r) => r != null);
      const yes = scored.filter((r) => r === 1).length;
      const missed = results.length - scored.length;
      const p = pct(yes, scored.length);
      const word = tr.type === "mts" ? "Yes" : "Occurred";
      return {
        headline: p == null ? "No intervals yet" : `${p}% of intervals`,
        metrics: [{ key: "pct", label: "% of intervals", value: p, unit: "%" },
          { key: "yes", label: `Intervals ${word.toLowerCase()}`, value: yes, unit: "" }],
        details: [["Intervals scored", scored.length], [word, yes], ["% of intervals", p == null ? "—" : `${p}%`],
          ...(missed ? [["Missed (not scored)", missed]] : [])],
      };
    }
    case "placheck": {
      const { completed } = intervalInfo(tr, e);
      const vals = [];
      for (let i = 0; i < completed; i++) { const v = tr.iv?.[i]; if (v) vals.push(v); }
      const pcts = vals.map((v) => (v.n ? (100 * v.engaged) / v.n : 0));
      const m = round(mean(pcts));
      return {
        headline: m == null ? "No checks yet" : `${m}% engaged`,
        metrics: [{ key: "pct", label: "% of group engaged", value: m, unit: "%" }],
        details: [["Checks", vals.length], ["Mean % engaged", m == null ? "—" : `${m}%`],
          ["Range", pcts.length ? `${round(Math.min(...pcts))}–${round(Math.max(...pcts))}%` : "—"],
          ...(completed - vals.length ? [["Missed (not scored)", completed - vals.length]] : [])],
      };
    }
    case "rating": {
      const { completed } = intervalInfo(tr, e);
      const vals = [];
      for (let i = 0; i < completed; i++) { const v = tr.iv?.[i]; if (v != null) vals.push(v); }
      const m = round(mean(vals));
      return {
        headline: m == null ? "No ratings yet" : `${m} mean rating`,
        metrics: [{ key: "mean", label: "Mean rating", value: m, unit: "" }],
        details: [["Ratings", vals.length], ["Mean", m ?? "—"], ["Scale", `1–${tr.config?.ratingMax || 5}`],
          ...(completed - vals.length ? [["Missed (not scored)", completed - vals.length]] : [])],
      };
    }
    case "abc": {
      const rows = ev.filter((x) => x.k === "abc");
      const top = (key) => mostCommon(rows.map((r) => r[key]).filter(Boolean));
      return {
        headline: `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`,
        metrics: [{ key: "count", label: "ABC entries", value: rows.length, unit: "" },
          { key: "rateHr", label: "Rate per hour", value: min > 0 ? round((rows.length / min) * 60) : null, unit: "/hr" }],
        details: [["Entries", rows.length], ["Most common antecedent", top("a") || "—"], ["Most common consequence", top("c") || "—"]],
      };
    }
    case "compliance": {
      const yes = ev.filter((x) => x.k === "comply").length;
      const prompted = ev.filter((x) => x.k === "prompted").length;
      const no = ev.filter((x) => x.k === "noncomply").length;
      const n = yes + prompted + no;
      return {
        headline: n ? `${pct(yes, n)}% complied` : "No instructions yet",
        metrics: [
          { key: "pct", label: "% complied independently", value: pct(yes, n), unit: "%" },
          { key: "pctAny", label: "% complied (incl. after prompt)", value: pct(yes + prompted, n), unit: "%" },
          { key: "n", label: "Instructions", value: n, unit: "" },
        ],
        details: [["Instructions", n], ["Complied", yes], ["After prompt", prompted], ["Did not comply", no],
          ["% complied", n ? `${pct(yes, n)}%` : "—"], ["% incl. prompted", n ? `${pct(yes + prompted, n)}%` : "—"]],
      };
    }
    case "dbr": {
      const rows = ev.filter((x) => x.k === "dbr");
      const metrics = DBR_ITEMS.map((it) => ({
        key: it.key, label: it.label, value: round(mean(rows.map((r) => r[it.key]).filter((v) => v != null))), unit: "/10",
      }));
      return {
        headline: rows.length ? metrics.map((m) => `${m.key.toUpperCase()} ${m.value ?? "—"}`).join(" · ") : "Not rated yet",
        metrics,
        details: [["Ratings", rows.length], ...metrics.map((m) => [m.label, m.value ?? "—"])],
        multi: true,
      };
    }
    default:
      return { headline: "", metrics: [], details: [] };
  }
}

function mostCommon(xs) {
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) || 0) + 1);
  let best = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best ? `${best} (${n})` : null;
}

// ---------- raw data for the Excel sheets ----------
export function rawTable(tr, session) {
  const e = sessionMs(session);
  const at = (ev) => [fmtTime(ev.t), fmtClock(ev.e), ev.p || ""];
  const head = ["Time", "Session time", "Period"];
  const ev = tr.events || [];
  switch (tr.type) {
    case "frequency": {
      const taps = ev.filter((x) => x.k === "tap");
      return {
        columns: ["#", ...head, "Seconds since previous (IRT)"],
        rows: taps.map((x, i) => [i + 1, ...at(x), i ? secs(x.e - taps[i - 1].e) : ""]),
      };
    }
    case "duration":
      return {
        columns: ["Episode", "Start time", "Start (session)", "End time", "End (session)", "Period", "Duration", "Seconds"],
        rows: durationEpisodes(tr, e).map((x, i) => [i + 1, fmtTime(x.start.t), fmtClock(x.start.e),
          x.stop ? fmtTime(x.stop.t) : "(session ended)", fmtClock(x.stop ? x.stop.e : e), x.start.p || "", fmtClock(x.ms), secs(x.ms)]),
      };
    case "latency":
      return {
        columns: ["Trial", "Instruction time", "Session time", "Period", "Response", "Latency (s)"],
        rows: latencyTrials(tr).filter((x) => !x.pending).map((x, i) => [i + 1, fmtTime(x.sd.t), fmtClock(x.sd.e), x.sd.p || "",
          x.resp ? "Responded" : "No response", x.resp ? secs(x.resp.e - x.sd.e) : ""]),
      };
    case "pir":
    case "wir":
    case "mts":
    case "placheck":
    case "rating": {
      const { completed, L } = intervalInfo(tr, e);
      const rows = [];
      for (let i = 0; i < completed; i++) {
        const r = intervalResult(tr, i);
        const v = tr.iv?.[i];
        let result;
        if (tr.type === "pir" || tr.type === "wir") result = r ? "Occurred" : "Did not occur";
        else if (tr.type === "mts") result = r == null ? "Missed" : r ? "Yes" : "No";
        else if (tr.type === "placheck") result = v ? `${v.engaged} of ${v.n} (${pct(v.engaged, v.n)}%)` : "Missed";
        else result = v == null ? "Missed" : v;
        rows.push([i + 1, fmtClock(i * L), fmtClock((i + 1) * L), periodAt(session, i * L) || "", result,
          tr.type === "placheck" ? (v ? pct(v.engaged, v.n) : "") : tr.type === "rating" ? (v ?? "") : r == null ? "" : r]);
      }
      const scoreCol = tr.type === "placheck" ? "% engaged" : tr.type === "rating" ? "Rating" : "Score (1 = yes)";
      return { columns: ["Interval", "Start", "End", "Period", "Result", scoreCol], rows };
    }
    case "abc":
      return {
        columns: ["#", ...head, "Antecedent", "Behavior", "Consequence", "Notes"],
        rows: ev.filter((x) => x.k === "abc").map((x, i) => [i + 1, ...at(x), x.a || "", x.b || "", parseOption(x.c || "").label || "", x.note || ""]),
      };
    case "compliance": {
      const word = { comply: "Complied", prompted: "Complied after prompt", noncomply: "Did not comply" };
      return {
        columns: ["#", ...head, "Response"],
        rows: ev.filter((x) => word[x.k]).map((x, i) => [i + 1, ...at(x), word[x.k]]),
      };
    }
    case "dbr":
      return {
        columns: ["#", ...head, ...DBR_ITEMS.map((x) => `${x.label} (0–10)`)],
        rows: ev.filter((x) => x.k === "dbr").map((x, i) => [i + 1, ...at(x), ...DBR_ITEMS.map((it) => x[it.key] ?? "")]),
      };
    default:
      return { columns: [], rows: [] };
  }
}

// Count of a tracker's events in each period (for scatterplots).
export function eventsByPeriod(tr, session) {
  const out = {};
  const add = (p, n = 1) => { if (p) out[p] = (out[p] || 0) + n; };
  if (tr.type === "duration") {
    for (const ep of durationEpisodes(tr, sessionMs(session))) add(ep.start.p, ep.ms / 60000); // minutes
  } else {
    const kind = { frequency: "tap", abc: "abc", compliance: "noncomply" }[tr.type];
    for (const ev of tr.events || []) if (ev.k === kind) add(ev.p);
  }
  return out;
}

export const supportsScatter = (type) => ["frequency", "duration", "abc"].includes(type);
export { INTERVAL_TYPES, MOMENT_TYPES };
