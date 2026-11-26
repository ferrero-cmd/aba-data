// Live data collection (one big tile per target) and the finished-session summary.
import * as db from "./db.js";
import { emailSession, buildWorkbook, preloadExcel } from "./export.js";
import { activeMs, DBR_ITEMS, initials, isRunning, INTERVAL_TYPES, parseOption, targetSpec, TYPES } from "./model.js";
import { durationOpen, fmtClock, fmtDate, fmtTime, intervalInfo, latencyOpen, sessionMs, summarize } from "./summary.js";
import { confirmSheet, flash, h, icon, sheet, toast } from "./ui.js";

// ======================================================================
// Live session
// ======================================================================
export async function liveSession(root, id, { go, settings }) {
  const session = await db.get("sessions", id);
  if (!session) { go("#/"); return; }
  if (session.status !== "active") { go(`#/r/${id}`, true); return; }
  const client = await db.get("clients", session.clientId);
  session.undo ??= [];

  const e = () => activeMs(session);
  const save = () => db.saveSession(session).catch(() => toast("Couldn't save — storage full?"));

  function addEvent(i, ev, label) {
    const tr = session.trackers[i];
    tr.events.push({ t: Date.now(), e: e(), ...ev });
    pushUndo({ i, kind: "ev", label: `${label} · ${tr.name}` });
  }
  function setInterval_(i, idx, value, label) {
    const tr = session.trackers[i];
    tr.iv ??= {};
    pushUndo({ i, kind: "iv", idx, prev: tr.iv[idx] ?? null, label: `${label} · ${tr.name}` });
    if (value == null) delete tr.iv[idx]; else tr.iv[idx] = value;
  }
  function pushUndo(entry) {
    session.undo.push(entry);
    if (session.undo.length > 60) session.undo.shift();
    save();
    refresh();
  }
  function undo() {
    const u = session.undo.pop();
    if (!u) return;
    if (u.kind === "ev") session.trackers[u.i].events.pop();
    else if (u.kind === "iv") { const iv = session.trackers[u.i].iv; if (u.prev == null) delete iv[u.idx]; else iv[u.idx] = u.prev; }
    save();
    refresh();
    toast(`Undid ${u.label}`);
  }

  // ---------- header ----------
  const clock = h("div", { class: "live-clock" }, "0:00");
  const pauseBtn = h("button", { class: "pill-btn", onclick: togglePause });
  const undoBar = h("div", { class: "undo-bar" });

  function togglePause() {
    const now = Date.now();
    if (isRunning(session)) {
      session.segments.at(-1).e = now;
      toast("Paused — intervals and timers are on hold");
    } else {
      session.segments.push({ s: now });
    }
    save();
    refresh();
  }

  // ---------- tiles ----------
  const grid = h("div", { class: `tile-grid ${session.trackers.length === 1 ? "single" : ""}` });
  const tiles = session.trackers.map((tr, i) => buildTile(tr, i));
  grid.append(...tiles.map((t) => t.el));

  function buildTile(tr, i) {
    const name = h("div", { class: "tile-name" }, tr.name);
    const spec = h("div", { class: "tile-spec" }, targetSpec(tr));
    const stat = h("div", { class: "tile-stat" });
    const head = h("div", { class: "tile-head" }, h("div", { class: "grow" }, name, spec), stat);
    const T = (cls, ...kids) => h("div", { class: `tile t-${tr.type} ${cls}` }, ...kids);
    const bump = (el) => { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); };

    switch (tr.type) {
      case "frequency": {
        const big = h("div", { class: "tile-big" }, "0");
        const el = h("button", { class: `tile t-frequency tap`, onclick: () => { addEvent(i, { k: "tap" }, "+1"); bump(el); } },
          head, big, h("div", { class: "tile-cta" }, "Tap +1"));
        return { el, update(ms) {
          const n = tr.events.filter((x) => x.k === "tap").length;
          big.textContent = n;
          stat.textContent = ms > 30000 ? `${Math.round((n / (ms / 60000)) * 60 * 10) / 10}/hr` : "";
        } };
      }
      case "duration": {
        const big = h("div", { class: "tile-big mono" }, "0:00");
        const cta = h("div", { class: "tile-cta" });
        const el = h("button", { class: `tile t-duration tap`, onclick: () => {
          const open = durationOpen(tr);
          addEvent(i, { k: open ? "stop" : "start" }, open ? "stop" : "start");
          bump(el);
        } }, head, big, cta);
        return { el, update(ms) {
          const open = durationOpen(tr);
          el.classList.toggle("running", !!open);
          const s = summarize(tr, session, ms);
          big.textContent = open ? fmtClock(ms - open.e) : s.details[0][1];
          stat.textContent = open ? `Total ${s.details[0][1]}` : `${s.metrics[2].value} ep`;
          cta.textContent = open ? "Tap when it stops" : "Tap when it starts";
        } };
      }
      case "latency": {
        const big = h("div", { class: "tile-big mono" }, "—");
        const btns = h("div", { class: "btn-row" });
        const el = T("span2", head, big, btns);
        const sd = h("button", { class: "act primary", onclick: () => addEvent(i, { k: "sd" }, "instruction") }, "Instruction given");
        const resp = h("button", { class: "act ok", onclick: () => { addEvent(i, { k: "resp" }, "response"); bump(el); } }, "Responded");
        const none = h("button", { class: "act ghost", onclick: () => addEvent(i, { k: "noresp" }, "no response") }, "No response");
        return { el, update(ms) {
          const open = latencyOpen(tr);
          const s = summarize(tr, session, ms);
          el.classList.toggle("running", !!open);
          big.textContent = open ? fmtClock(ms - open.e) : (s.metrics[0].value != null ? `${s.metrics[0].value} s` : "—");
          stat.textContent = `${s.metrics[2].value} trials`;
          const want = open ? [resp, none] : [sd];
          if (btns.children[0] !== want[0]) btns.replaceChildren(...want);
        } };
      }
      case "pir":
      case "wir": {
        const ring = ringEl();
        const state = h("div", { class: "tile-state" });
        const el = h("button", { class: `tile t-${tr.type} tap`, onclick: () => {
          const info = intervalInfo(tr, e());
          if (info.current == null) return;
          const marked = tr.type === "pir" ? tr.iv?.[info.current] === 1 : tr.iv?.[info.current] === 0;
          const val = marked ? null : tr.type === "pir" ? 1 : 0;
          setInterval_(i, info.current, val, marked ? "clear" : tr.type === "pir" ? "occurred" : "stopped");
          bump(el);
        } }, head, h("div", { class: "ring-wrap" }, ring.el, state));
        return { el, update(ms) {
          const info = intervalInfo(tr, ms);
          const s = summarize(tr, session, ms);
          stat.textContent = s.metrics[0].value == null ? "" : `${s.metrics[0].value}%`;
          if (info.finished) { ring.set(1, "✓"); state.textContent = `Done · ${info.completed} intervals`; el.classList.add("finished"); return; }
          ring.set(1 - info.remaining / info.L, `#${info.current + 1}`);
          const marked = tr.type === "pir" ? tr.iv?.[info.current] === 1 : tr.iv?.[info.current] === 0;
          el.classList.toggle("marked", marked);
          state.textContent = tr.type === "pir"
            ? (marked ? "Occurred ✓ (tap to clear)" : "Tap if it happens")
            : (marked ? "Stopped ✗ (tap to clear)" : "Tap if it stops");
        } };
      }
      case "mts":
      case "placheck":
      case "rating": {
        const ring = ringEl();
        const prompt = h("div", { class: "tile-prompt" });
        const controls = h("div", { class: "moment-controls" });
        const el = T("span2", head, h("div", { class: "moment" }, h("div", { class: "ring-wrap small" }, ring.el), prompt), controls);
        let shownFor = -2;
        let count = null;
        const pendingIdx = (ms) => {
          const info = intervalInfo(tr, ms);
          const last = info.completed - 1;
          return last >= 0 && tr.iv?.[last] == null ? last : null;
        };
        const answer = (idx, value, label) => { setInterval_(i, idx, value, label); bump(el); };
        const drawControls = (idx) => {
          if (idx == null) { controls.replaceChildren(); return; }
          if (tr.type === "mts") {
            controls.replaceChildren(
              h("button", { class: "act ok", onclick: () => answer(idx, 1, "yes") }, "Yes"),
              h("button", { class: "act no", onclick: () => answer(idx, 0, "no") }, "No"));
          } else if (tr.type === "rating") {
            const max = tr.config.ratingMax || 5;
            controls.replaceChildren(...Array.from({ length: max }, (_, k) =>
              h("button", { class: "act num", onclick: () => answer(idx, k + 1, `rated ${k + 1}`) }, k + 1)));
          } else {
            const n = tr.config.groupSize || 5;
            const prev = [...Object.values(tr.iv || {})].at(-1);
            count = Math.min(n, prev?.engaged ?? n);
            const label = h("div", { class: "stepper-val" });
            const draw = () => { label.replaceChildren(h("b", {}, count), ` of ${n} engaged`); };
            draw();
            controls.replaceChildren(h("div", { class: "stepper" },
              h("button", { class: "act step", onclick: () => { count = Math.max(0, count - 1); draw(); }, "aria-label": "One fewer" }, "−"),
              label,
              h("button", { class: "act step", onclick: () => { count = Math.min(n, count + 1); draw(); }, "aria-label": "One more" }, "+")),
            h("button", { class: "act ok wide", onclick: () => answer(idx, { engaged: count, n }, `${count}/${n}`) }, "Save"));
          }
        };
        return { el, update(ms) {
          const info = intervalInfo(tr, ms);
          const s = summarize(tr, session, ms);
          const m = s.metrics[0].value;
          stat.textContent = m == null ? "" : tr.type === "rating" ? `${m} avg` : `${m}%`;
          const idx = pendingIdx(ms);
          el.classList.toggle("pending", idx != null);
          if (info.finished && idx == null) {
            ring.set(1, "✓"); prompt.textContent = `Done · ${info.completed} intervals`; el.classList.add("finished");
          } else {
            ring.set(info.finished ? 1 : 1 - info.remaining / info.L, info.finished ? "✓" : fmtClock(info.remaining + 999));
            const q = tr.type === "mts" ? "Happening right now?" : tr.type === "rating" ? "Rate the interval" : "How many engaged?";
            prompt.replaceChildren(idx != null
              ? h("span", {}, h("b", {}, q), h("span", { class: "muted" }, ` · interval ${idx + 1}`))
              : h("span", { class: "muted" }, `Next check in ${fmtClock(info.remaining + 999)}`));
          }
          if (idx !== shownFor) { shownFor = idx; drawControls(idx); }
        } };
      }
      case "abc": {
        const big = h("div", { class: "tile-big" }, "0");
        const el = h("button", { class: "tile t-abc tap", onclick: () => abcSheet(i) }, head, big, h("div", { class: "tile-cta" }, "Tap to log ABC"));
        return { el, update() { big.textContent = tr.events.filter((x) => x.k === "abc").length; } };
      }
      case "compliance": {
        const el = T("span2", head, h("div", { class: "btn-row three" },
          h("button", { class: "act ok", onclick: () => { addEvent(i, { k: "comply" }, "complied"); bump(el); } }, "Complied"),
          h("button", { class: "act warn", onclick: () => { addEvent(i, { k: "prompted" }, "after prompt"); bump(el); } }, "After prompt"),
          h("button", { class: "act no", onclick: () => { addEvent(i, { k: "noncomply" }, "did not comply"); bump(el); } }, "Did not")));
        return { el, update(ms) {
          const s = summarize(tr, session, ms);
          stat.textContent = s.metrics[2].value ? `${s.metrics[0].value}% · ${s.metrics[2].value}` : "";
        } };
      }
      case "dbr": {
        const big = h("div", { class: "tile-big small" }, "—");
        const el = h("button", { class: "tile t-dbr tap", onclick: () => dbrSheet(i) }, head, big, h("div", { class: "tile-cta" }, "Tap to rate"));
        return { el, update() {
          const last = tr.events.filter((x) => x.k === "dbr").at(-1);
          big.textContent = last ? DBR_ITEMS.map((it) => `${it.key.toUpperCase()} ${last[it.key]}`).join(" ") : "—";
          stat.textContent = `${tr.events.filter((x) => x.k === "dbr").length}×`;
        } };
      }
      default:
        return { el: T("", head), update() {} };
    }
  }

  // ---------- ABC + DBR sheets ----------
  function abcSheet(i) {
    const problem = session.trackers.filter((t) => ["frequency", "duration", "pir"].includes(t.type));
    const behaviors = [...new Set((problem.length ? problem : session.trackers.filter((t) => !["abc", "dbr"].includes(t.type))).map((t) => t.name))];
    const pick = { a: null, b: behaviors.length === 1 ? behaviors[0] : null, c: null };
    const note = h("textarea", { class: "input", rows: 2, placeholder: "Notes (optional)" });
    const row = (key, title, options) => {
      const wrap = h("div", { class: "chips wrap" });
      const draw = () => wrap.replaceChildren(...options.map((opt) => {
        const label = parseOption(opt).label;
        return h("button", { class: `chip ${pick[key] === opt ? "on" : ""}`, type: "button",
          onclick: () => { pick[key] = pick[key] === opt ? null : opt; draw(); } }, label);
      }));
      draw();
      return h("div", { class: "abc-row" }, h("div", { class: "abc-title" }, h("span", { class: "abc-letter" }, key.toUpperCase()), title), wrap);
    };
    sheet("Log ABC", (close) => h("div", {},
      row("a", "Antecedent", settings.abcA),
      row("b", "Behavior", behaviors.length ? [...behaviors, "Other"] : ["Target behavior", "Other"]),
      row("c", "Consequence", settings.abcC),
      note,
      h("button", { class: "btn big primary sticky-action", onclick: () => {
        if (!pick.a && !pick.b && !pick.c && !note.value.trim()) { toast("Pick at least one"); return; }
        addEvent(i, { k: "abc", a: pick.a ? parseOption(pick.a).label : "", b: pick.b || "", c: pick.c || "", note: note.value.trim() }, "ABC");
        close();
        toast("ABC saved");
      } }, "Save ABC")), { className: "tall" });
  }

  function dbrSheet(i, after) {
    const vals = {};
    const rows = DBR_ITEMS.map((it) => {
      const wrap = h("div", { class: "dbr-scale" });
      const draw = () => wrap.replaceChildren(...Array.from({ length: 11 }, (_, n) =>
        h("button", { class: `dbr-n ${vals[it.key] === n ? "on" : ""}`, type: "button", onclick: () => { vals[it.key] = n; draw(); } }, n)));
      draw();
      return h("div", { class: "dbr-item" }, h("div", { class: "dbr-label" }, h("b", {}, it.label), h("span", { class: "muted small" }, ` · ${it.hint}`)), wrap,
        h("div", { class: "dbr-ends small muted" }, h("span", {}, "0 Never"), h("span", {}, "5 Sometimes"), h("span", {}, "10 Always")));
    });
    sheet("Rate this session", (close) => h("div", {}, ...rows,
      h("button", { class: "btn big primary sticky-action", onclick: () => {
        if (DBR_ITEMS.some((it) => vals[it.key] == null)) { toast("Rate all three"); return; }
        addEvent(i, { k: "dbr", ...vals }, "DBR");
        close();
        after?.();
      } }, after ? "Save & end session" : "Save rating")), { className: "tall" });
  }

  // ---------- end ----------
  async function endSession() {
    const unrated = session.trackers.findIndex((t) => t.type === "dbr" && !t.events.some((x) => x.k === "dbr"));
    if (unrated >= 0) {
      sheet("End session", (close) => h("div", { class: "stack" },
        h("p", { class: "muted" }, `${session.trackers[unrated].name} hasn't been rated yet.`),
        h("button", { class: "btn big primary", onclick: () => { close(); dbrSheet(unrated, finish); } }, "Rate now, then end"),
        h("button", { class: "btn big", onclick: () => { close(); finish(); } }, "End without rating"),
        h("button", { class: "btn big ghost", onclick: close }, "Keep collecting")));
      return;
    }
    if (await confirmSheet("End session?", `Observation time ${fmtClock(e())}. You can email the Excel file next.`, "End session")) finish();
  }
  async function finish() {
    const now = Date.now();
    session.trackers.forEach((tr) => {
      if (tr.type === "duration" && durationOpen(tr)) tr.events.push({ t: now, e: e(), k: "stop" });
    });
    const seg = session.segments.at(-1);
    if (seg && seg.e == null) seg.e = now;
    session.status = "done";
    session.endedAt = now;
    delete session.undo;
    await db.saveSession(session);
    go(`#/r/${session.id}`, true);
  }

  // ---------- refresh / tick ----------
  const lastCompleted = session.trackers.map((tr) => (INTERVAL_TYPES.has(tr.type) ? intervalInfo(tr, e()).completed : 0));
  function refresh() {
    const ms = e();
    const running = isRunning(session);
    clock.textContent = fmtClock(ms);
    root.classList.toggle("paused", !running);
    pauseBtn.replaceChildren(running ? icon.pause() : icon.play(), running ? "Pause" : "Resume");
    tiles.forEach((t) => t.update(ms));
    const u = session.undo.at(-1);
    undoBar.replaceChildren(u
      ? h("button", { class: "undo-btn", onclick: undo }, icon.undo(), h("span", {}, "Undo ", h("b", {}, u.label)))
      : h("span", { class: "muted small" }, "Every tap is saved on this phone"));
  }
  function tick() {
    const ms = e();
    let crossed = false;
    session.trackers.forEach((tr, i) => {
      if (!INTERVAL_TYPES.has(tr.type)) return;
      const c = intervalInfo(tr, ms).completed;
      if (c > lastCompleted[i]) crossed = true;
      lastCompleted[i] = c;
    });
    if (crossed) flash();
    refresh();
  }

  // ---------- assemble ----------
  root.append(h("main", { class: "view live" },
    h("header", { class: "topbar" },
      h("button", { class: "back-btn", onclick: () => go(`#/c/${client.id}`) }, icon.back(), initials(client)),
      h("div", { class: "grow" }),
      pauseBtn,
      h("button", { class: "pill-btn danger", onclick: endSession }, icon.stop(), "End")),
    h("div", { class: "live-head" }, clock, h("div", { class: "live-sub muted" }, `Started ${fmtTime(session.startedAt)}`)),
    grid,
    undoBar));
  refresh();
  const timer = setInterval(tick, 250);

  // Keep the screen on while collecting.
  let lock = null;
  const wake = async () => { try { if (document.visibilityState === "visible") lock = await navigator.wakeLock?.request("screen"); } catch { /* not supported */ } };
  const onVis = () => { if (document.visibilityState === "visible") { wake(); tick(); } };
  document.addEventListener("visibilitychange", onVis);
  wake();

  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVis);
    lock?.release?.().catch(() => {});
  };
}

const hm = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function ringEl() {
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 64 64");
  s.setAttribute("class", "ring");
  s.innerHTML = `<circle cx="32" cy="32" r="28" class="ring-bg"/><circle cx="32" cy="32" r="28" class="ring-fg" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>`;
  const label = h("div", { class: "ring-label" });
  const el = h("div", { class: "ring-box" }, s, label);
  const fg = s.querySelector(".ring-fg");
  return { el, set(frac, text) { fg.setAttribute("stroke-dashoffset", String(100 - Math.max(0, Math.min(1, frac)) * 100)); label.textContent = text; } };
}

// ======================================================================
// Session summary (after End, or opening a past session)
// ======================================================================
export async function sessionSummary(root, id, { go }) {
  const session = await db.get("sessions", id);
  if (!session) { go("#/"); return; }
  if (session.status === "active") { go(`#/s/${id}`, true); return; }
  const client = await db.get("clients", session.clientId);
  const e = sessionMs(session);

  let prepared = null;
  const prepare = () => { prepared = buildWorkbook(client, session).catch(() => null); };
  preloadExcel().then(prepare);

  const notes = h("textarea", { class: "input", rows: 3, placeholder: "Session notes (setting, staff, anything unusual)…", value: session.notes || "" });
  let t;
  notes.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => { session.notes = notes.value; await db.saveSession(session); prepare(); }, 500);
  });

  const emailBtn = h("button", { class: "btn big primary", onclick: async () => {
    emailBtn.disabled = true;
    try {
      if (notes.value !== (session.notes || "")) { session.notes = notes.value; await db.saveSession(session); prepare(); }
      const file = await prepared;
      const result = await emailSession(client, session, file || undefined);
      if (result === "shared" || result === "downloaded") { session.exportedAt = Date.now(); await db.saveSession(session); }
    } catch (err) { toast(err.message || "Couldn't make the Excel file"); }
    emailBtn.disabled = false;
  } }, icon.mail(), "Email Excel");

  root.append(h("main", { class: "view" },
    h("header", { class: "topbar" },
      h("button", { class: "back-btn", onclick: () => go(`#/c/${client.id}`) }, icon.back(), initials(client))),
    h("div", { class: "hero" },
      h("div", { class: "eyebrow" }, fmtDate(session.startedAt)),
      h("h1", {}, `${hm(session.startedAt)} – ${hm(session.endedAt)}`),
      h("div", { class: "muted" }, `${fmtClock(e)} observed`)),
    h("div", { class: "actions" }, emailBtn,
      session.exportedAt ? h("div", { class: "muted small center" }, `Last exported ${fmtDate(session.exportedAt)} ${fmtTime(session.exportedAt)}`) : null),
    ...session.trackers.map((tr) => {
      const s = summarize(tr, session, e);
      return h("section", { class: "card result" },
        h("div", { class: "result-head" },
          h("div", { class: "grow" }, h("div", { class: "result-name" }, tr.name), h("div", { class: "muted small" }, TYPES[tr.type].label + (INTERVAL_TYPES.has(tr.type) ? ` · ${targetSpec(tr)}` : ""))),
          h("div", { class: "result-headline" }, s.headline)),
        h("dl", { class: "kv" }, ...s.details.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, String(v))])));
    }),
    h("section", { class: "card" }, h("div", { class: "field-label" }, "Notes"), notes),
    h("button", { class: "link-btn danger", onclick: async () => {
      if (await confirmSheet("Delete this session?", "Its data will be removed from this phone. This can't be undone.", "Delete session", { danger: true })) {
        await db.del("sessions", session.id);
        go(`#/c/${client.id}`, true);
      }
    } }, "Delete session")));
}

