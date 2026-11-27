// ABA Data — router and the client / target / settings screens.
import * as db from "./db.js";
import { abcLists, CONFIG_FIELDS, initials, INTERVAL_TYPES, newClient, newTarget, parseOption, targetSpec, TYPES, uid, usageCounts } from "./model.js";
import { liveSession, sessionSummary } from "./session.js";
import { fmtDate, fmtTime, sessionMs, summarize, fmtClock } from "./summary.js";
import { $, closeAllSheets, confirmSheet, download, field, h, hueFor, icon, listEditor, segmented, sheet, shareFile, toast } from "./ui.js";

const root = $("#app");
let cleanup = null;
let settings;
// A live session can hold the user on its screen: any navigation it didn't ask for (e.g. the iOS
// swipe-back gesture) is undone and the guard runs instead, so leaving always goes through its prompt.
let leaveGuard = null;
let shownHash = null;
const guard = (fn) => { leaveGuard = fn; };

function go(hash, replace = false) {
  if (replace) history.replaceState(null, "", hash);
  else if (location.hash !== hash) { location.hash = hash; return; }
  route();
}

async function route() {
  const target = location.hash || "#/";
  if (leaveGuard && shownHash && target !== shownHash) {
    history.pushState(null, "", shownHash);
    leaveGuard();
    return;
  }
  leaveGuard = null;
  shownHash = target;
  cleanup?.();
  cleanup = null;
  closeAllSheets();
  const [, view, id, tab] = (location.hash || "#/").split("/");
  root.className = "";
  root.replaceChildren();
  const ctx = { go, settings, guard };
  try {
    if (view === "c" && id) await clientView(id, tab || "sessions");
    else if (view === "s" && id) cleanup = await liveSession(root, id, ctx);
    else if (view === "r" && id) await sessionSummary(root, id, ctx);
    else if (view === "settings") await settingsView();
    else await homeView();
  } catch (err) {
    console.error(err);
    root.append(h("main", { class: "view" }, h("div", { class: "banner error" }, `Something went wrong: ${err.message}`),
      h("button", { class: "btn", onclick: () => go("#/") }, "Back to clients")));
  }
  window.scrollTo(0, 0);
}

const avatar = (c, big = false) =>
  h("div", { class: `avatar ${big ? "big" : ""}`, style: { "--h": hueFor(c.school) } },
    h("span", {}, c.first), h("span", { class: "avatar-school" }, c.school));

// On the home list the banner names the client; on that client's own page it doesn't need to.
const resumeBanner = (s, c, { showClient = true } = {}) =>
  h("button", { class: "resume-banner", onclick: () => go(`#/s/${s.id}`) },
    h("span", { class: "live-dot" }), h("div", { class: "grow" }, h("b", {}, showClient ? `Session in progress · ${initials(c)}` : "Session in progress"),
      h("div", { class: "small" }, `${fmtClock(sessionMs(s))} · tap to return`)), icon.chevron());

const ago = (t) => {
  if (!t) return "No sessions yet";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return `Today ${fmtTime(t).replace(/:\d\d(?=\s|$)/, "")}`;
  if (days < 2) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return fmtDate(t);
};

// ======================================================================
// Home: client list
// ======================================================================
async function homeView() {
  const [clients, sessions] = await Promise.all([db.getAll("clients"), db.getAll("sessions")]);
  const stats = new Map();
  for (const s of sessions) {
    const st = stats.get(s.clientId) || { n: 0, last: 0 };
    st.n++;
    st.last = Math.max(st.last, s.startedAt);
    stats.set(s.clientId, st);
  }
  const active = sessions.filter((s) => s.status === "active");
  let query = "";
  let showArchived = false;
  const list = h("div", { class: "client-list" });

  function draw() {
    const q = query.trim().toUpperCase();
    const shown = clients
      .filter((c) => showArchived || !c.archived)
      .filter((c) => !q || `${c.first} ${c.school} ${c.first}${c.school} ${c.label || ""}`.toUpperCase().includes(q));
    const byName = (a, b) => a.first.localeCompare(b.first) || a.school.localeCompare(b.school);
    let groups;
    if (settings.sort === "school") {
      const m = new Map();
      for (const c of [...shown].sort((a, b) => a.school.localeCompare(b.school) || byName(a, b))) {
        if (!m.has(c.school)) m.set(c.school, []);
        m.get(c.school).push(c);
      }
      groups = [...m].map(([k, v]) => [`School ${k}`, v]);
    } else if (settings.sort === "recent") {
      groups = [["", [...shown].sort((a, b) => (stats.get(b.id)?.last || b.createdAt) - (stats.get(a.id)?.last || a.createdAt))]];
    } else {
      groups = [["", [...shown].sort(byName)]];
    }
    if (!clients.length) {
      list.replaceChildren(h("div", { class: "empty-state" },
        h("div", { class: "empty-art" }, icon.list()),
        h("h2", {}, "No clients yet"),
        h("p", { class: "muted" }, "Tap + to add a client with just their first initial and school initial.")));
      return;
    }
    if (!shown.length) { list.replaceChildren(h("p", { class: "empty" }, "No matches")); return; }
    list.replaceChildren(...groups.flatMap(([title, cs]) => [
      title ? h("div", { class: "group-title" }, title, h("span", { class: "count" }, cs.length)) : null,
      h("div", { class: "list-card" }, ...cs.map((c) => {
        const st = stats.get(c.id);
        return h("button", { class: `client-row ${c.archived ? "archived" : ""}`, onclick: () => go(`#/c/${c.id}`) },
          avatar(c),
          h("div", { class: "grow" },
            h("div", { class: "client-name" }, initials(c), c.label ? h("span", { class: "client-label" }, c.label) : null),
            h("div", { class: "muted small" }, st ? `${ago(st.last)} · ${st.n} session${st.n === 1 ? "" : "s"}` : `${c.targets.filter((t) => !t.archived).length} targets · no sessions yet`)),
          icon.chevron());
      })),
    ]));
  }

  const search = h("input", { class: "search-input", type: "search", placeholder: "Search initials", autocomplete: "off",
    oninput: (ev) => { query = ev.target.value; draw(); } });
  const archivedCount = clients.filter((c) => c.archived).length;

  root.append(h("main", { class: "view home" },
    h("header", { class: "topbar" },
      h("h1", { class: "brand" }, h("span", { class: "brand-mark" }), "ABA Data"),
      h("button", { class: "icon-btn", onclick: () => go("#/settings"), "aria-label": "Settings" }, icon.gear())),
    ...active.map((s) => {
      const c = clients.find((x) => x.id === s.clientId);
      return c ? resumeBanner(s, c) : null;
    }),
    h("div", { class: "search" }, icon.search(), search),
    segmented([["school", "By school"], ["az", "A–Z"], ["recent", "Recent"]], settings.sort, async (v) => {
      settings.sort = v; await db.saveSettings(settings); draw();
    }, "sort"),
    list,
    archivedCount ? h("button", { class: "link-btn", onclick: (ev) => {
      showArchived = !showArchived; ev.target.textContent = showArchived ? "Hide archived" : `Show archived (${archivedCount})`; draw();
    } }, `Show archived (${archivedCount})`) : null,
    h("button", { class: "fab", onclick: addClientSheet, "aria-label": "Add client" }, icon.plus())));
  draw();
}

function initialInput(placeholder, max) {
  return h("input", { class: "initial-input", maxlength: max, placeholder, autocapitalize: "characters", autocomplete: "off",
    spellcheck: "false", inputmode: "text", oninput: (ev) => { ev.target.value = ev.target.value.replace(/[^a-z]/gi, "").toUpperCase(); } });
}

function addClientSheet(existing) {
  const editing = existing && existing.id;
  const first = initialInput("", 3);
  const school = initialInput("", 4);
  const label = h("input", { class: "input", placeholder: "Optional note, e.g. Gr 3 or Rm 12", maxlength: 40 });
  if (editing) { first.value = existing.first; school.value = existing.school; label.value = existing.label || ""; }
  first.addEventListener("input", () => { if (first.value.length >= 1 && !editing) school.focus(); });
  sheet(editing ? "Edit client" : "New client", (close) => {
    const submit = async (ev) => {
      ev?.preventDefault();
      if (!first.value || !school.value) { toast("Enter both initials"); return; }
      if (editing) {
        Object.assign(existing, { first: first.value, school: school.value, label: label.value.trim() });
        await db.saveClient(existing);
        close();
        route();
      } else {
        const c = await db.saveClient(newClient(first.value, school.value, label.value));
        close();
        go(`#/c/${c.id}/targets`);
      }
    };
    return h("form", { class: "stack", onsubmit: submit },
      h("div", { class: "initials-pair" },
        h("label", {}, h("span", { class: "field-label" }, "First initial"), first),
        h("label", {}, h("span", { class: "field-label" }, "School initial"), school)),
      label,
      h("p", { class: "muted small" }, "Initials only — no names are stored."),
      h("button", { class: "btn big primary", type: "submit" }, editing ? "Save" : "Add client"));
  });
  setTimeout(() => first.focus(), 300);
}

// ======================================================================
// Client profile
// ======================================================================
async function clientView(id, tab) {
  const client = await db.get("clients", id);
  if (!client) { go("#/", true); return; }
  const sessions = (await db.sessionsFor(id)).sort((a, b) => b.startedAt - a.startedAt);
  const active = sessions.find((s) => s.status === "active");
  const body = h("div", { class: "tab-body" });

  const tabs = segmented([["sessions", "Sessions"], ["targets", "Targets"], ["graphs", "Graphs"]], tab, (t) => {
    history.replaceState(null, "", `#/c/${id}/${t}`);
    drawTab(t);
  }, "tabs");

  async function drawTab(t) {
    body.replaceChildren();
    if (t === "targets") body.append(targetsTab(client));
    else if (t === "graphs") {
      const { graphsTab } = await import("./graphs.js");
      body.append(await graphsTab(client, sessions, { go, settings, save: () => db.saveClient(client) }));
    } else body.append(sessionsTab(client, sessions));
  }

  root.append(h("main", { class: "view" },
    h("header", { class: "topbar" },
      h("button", { class: "back-btn", onclick: () => go("#/") }, icon.back(), "Clients"),
      h("div", { class: "grow" }),
      h("button", { class: "icon-btn", onclick: () => clientMenu(client), "aria-label": "Edit client" }, icon.edit())),
    h("div", { class: "profile-head" }, avatar(client, true),
      h("div", {}, h("h1", {}, initials(client)),
        h("div", { class: "muted" }, [client.label, `${sessions.length} session${sessions.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")))),
    active
      ? resumeBanner(active, client, { showClient: false })
      : h("button", { class: "btn big primary start", onclick: () => {
        if (!client.targets.some((t) => !t.archived)) { toast("Add a target first"); tabs.querySelectorAll("button")[1].click(); targetSheet(client, null, () => route()); return; }
        startSessionSheet(client);
      } }, icon.play(), "Start session"),
    tabs,
    body));
  drawTab(tab);
}

function clientMenu(client) {
  sheet(initials(client), (close) => h("div", { class: "stack" },
    h("button", { class: "btn big", onclick: () => { close(); setTimeout(() => addClientSheet(client), 280); } }, "Edit initials / note"),
    h("button", { class: "btn big", onclick: () => { close(); setTimeout(() => clientAbcSheet(client), 280); } },
      client.abc ? "ABC options (custom for this client)" : "ABC options for this client"),
    h("label", { class: "toggle big-toggle" },
      h("input", { type: "checkbox", checked: !!client.periods, onchange: async (ev) => {
        client.periods = ev.target.checked; await db.saveClient(client);
        toast(client.periods ? "Period tracking on for this client" : "Period tracking off");
      } }),
      h("span", { class: "grow" }, h("b", {}, "Track periods / activities"), h("div", { class: "muted small" }, "Shows a row of period buttons during sessions, for the scatterplot."))),
    h("button", { class: "btn big", onclick: async () => {
      client.archived = !client.archived; await db.saveClient(client); close(); toast(client.archived ? "Archived" : "Restored"); route();
    } }, client.archived ? "Unarchive client" : "Archive client (hide from list)"),
    h("button", { class: "btn big danger", onclick: async () => {
      close();
      if (await confirmSheet(`Delete ${initials(client)}?`, "This deletes the client and all of their sessions from this phone. It can't be undone. (Tip: archive instead to keep the data.)", "Delete everything", { danger: true })) {
        await db.deleteClient(client.id);
        go("#/", true);
      }
    } }, "Delete client…")));
}

// Per-client ABC lists. Off = use the default lists from Settings.
async function clientAbcSheet(client) {
  const sessions = await db.sessionsFor(client.id);
  const body = h("div", { class: "stack" });
  const draw = () => {
    const custom = !!client.abc;
    const editor = (key) => {
      const L = abcLists(settings, client);
      return listEditor({
        items: L[key], starred: L.star[key], labelOf: (x) => parseOption(x).label,
        placeholder: key === "a" ? "Add an antecedent" : "Add a consequence",
        counts: () => usageCounts(sessions, key),
        onChange: async (items, starred) => {
          client.abc[key] = items;
          client.abc.star[key] = starred;
          await db.saveClient(client);
        },
      });
    };
    body.replaceChildren(
      h("label", { class: "toggle big-toggle" },
        h("input", { type: "checkbox", checked: custom, onchange: async (ev) => {
          if (ev.target.checked) {
            const L = abcLists(settings, null);
            client.abc = { a: [...L.a], c: [...L.c], star: { a: [...L.star.a], c: [...L.star.c] } };
          } else {
            if (!(await confirmSheet("Use the default lists?", "This client's custom order and options will be removed. Past data isn't changed.", "Use defaults"))) { ev.target.checked = true; return; }
            client.abc = null;
          }
          await db.saveClient(client);
          draw();
        } }),
        h("span", { class: "grow" }, h("b", {}, "Custom lists for this client"),
          h("div", { class: "muted small" }, custom ? "Changes here only affect this client." : "Off: uses the default lists from Settings."))),
      custom ? [h("div", { class: "field-label" }, "Antecedents"), editor("a"), h("div", { class: "field-label" }, "Consequences"), editor("c"),
        h("p", { class: "field-hint" }, "Drag ⋮⋮ to reorder, ★ keeps an option at the top. “Sort by most used” uses this client's ABC data.")] : null);
  };
  draw();
  sheet(`ABC options · ${initials(client)}`, body, { className: "tall" });
}

function sessionsTab(client, sessions) {
  if (!sessions.length) {
    return h("div", { class: "empty-state small" }, h("p", { class: "muted" },
      client.targets.some((t) => !t.archived) ? "No sessions yet. Tap Start session when you're ready to collect." : "Add target behaviors first, then start a session."),
    client.targets.some((t) => !t.archived) ? null : h("button", { class: "btn", onclick: () => go(`#/c/${client.id}/targets`) }, "Add targets"));
  }
  let month = "";
  const finished = sessions.filter((s) => s.status === "done");
  return h("div", {},
    finished.length ? h("button", { class: "btn select-email", onclick: () => multiEmailSheet(client, sessions) }, icon.mail(), "Select & email sessions…") : null,
    ...sessions.flatMap((s) => {
    const m = new Date(s.startedAt).toLocaleDateString([], { month: "long", year: "numeric" });
    const head = m !== month ? h("div", { class: "group-title" }, (month = m)) : null;
    return [head, h("button", { class: "session-row card", onclick: () => go(s.status === "active" ? `#/s/${s.id}` : `#/r/${s.id}`) },
      h("div", { class: "session-date" },
        h("div", { class: "d" }, new Date(s.startedAt).getDate()),
        h("div", { class: "w" }, new Date(s.startedAt).toLocaleDateString([], { weekday: "short" }))),
      h("div", { class: "grow" },
        h("div", { class: "session-title" }, `${fmtTime(s.startedAt).replace(/:\d\d(?=\s|$)/, "")} · ${fmtClock(sessionMs(s))}`,
          s.status === "active" ? h("span", { class: "badge live" }, "Live") : s.exportedAt ? h("span", { class: "badge ok" }, "Sent") : null),
        h("div", { class: "session-lines" }, ...s.trackers.slice(0, 4).map((tr) =>
          h("div", { class: "small" }, h("span", { class: "muted" }, `${tr.name}: `), summarize(tr, s).headline)),
          s.trackers.length > 4 ? h("div", { class: "small muted" }, `+${s.trackers.length - 4} more`) : null)),
      icon.chevron())];
  }));
}

// Pick several finished sessions and email them as one Excel file. Unsent first (newest first);
// already-sent ones sit at the bottom, greyed with their Sent badge, and can still be included.
function multiEmailSheet(client, sessions) {
  const done = sessions.filter((s) => s.status === "done").sort((a, b) => b.startedAt - a.startedAt);
  const unsent = done.filter((s) => !s.exportedAt);
  const sent = done.filter((s) => s.exportedAt);
  const picked = new Set(unsent.map((s) => s.id));
  const sendBtn = h("button", { class: "btn big primary sticky-action" });
  const drawBtn = () => {
    sendBtn.replaceChildren(icon.mail(), picked.size ? `Email ${picked.size} session${picked.size === 1 ? "" : "s"}` : "Pick sessions to email");
    sendBtn.disabled = !picked.size;
  };
  const row = (s) => {
    const lines = s.trackers.slice(0, 3).map((tr) => `${tr.name}: ${summarize(tr, s).headline}`).join(" · ");
    return h("label", { class: `check-row ${s.exportedAt ? "sent" : ""}` },
      h("input", { type: "checkbox", checked: picked.has(s.id), onchange: (ev) => { ev.target.checked ? picked.add(s.id) : picked.delete(s.id); drawBtn(); } }),
      h("div", { class: "grow" },
        h("div", { class: "target-name" }, `${fmtDate(s.startedAt)} · ${fmtTime(s.startedAt).replace(/:\d\d(?=\s|$)/, "")}`,
          s.exportedAt ? h("span", { class: "badge ok" }, "Sent") : null),
        h("div", { class: "muted small" }, `${fmtClock(sessionMs(s))}${lines ? ` · ${lines}` : ""}`)));
  };
  const setAll = (on) => {
    for (const s of done) on ? picked.add(s.id) : picked.delete(s.id);
    panel.el.querySelectorAll(".check-row input").forEach((c) => { c.checked = on; });
    drawBtn();
  };
  sendBtn.addEventListener("click", async () => {
    const chosen = done.filter((s) => picked.has(s.id));
    if (!chosen.length) return;
    sendBtn.disabled = true;
    try {
      const { emailSessions } = await import("./export.js");
      const result = await emailSessions(client, chosen, undefined, sessions);
      if (result === "shared" || result === "downloaded") {
        const now = Date.now();
        for (const s of chosen) { s.exportedAt = now; await db.saveSession(s); }
        panel.close();
        route();
        return;
      }
    } catch (err) { toast(err.message || "Couldn't make the Excel file"); }
    drawBtn();
  });
  drawBtn();
  import("./export.js").then((m) => m.preloadExcel());
  const panel = sheet("Email sessions", h("div", { class: "stack" },
    h("p", { class: "muted small" }, "Ticked sessions go into one Excel file, with graphs of every session to date."),
    h("div", { class: "row-btns" },
      h("button", { class: "btn small", type: "button", onclick: () => setAll(true) }, "Select all"),
      h("button", { class: "btn small ghost", type: "button", onclick: () => setAll(false) }, "Clear")),
    unsent.length ? h("div", { class: "list-card" }, ...unsent.map(row)) : h("p", { class: "muted small" }, "Every session has been sent already."),
    sent.length ? [h("div", { class: "group-title tight" }, "Already sent"), h("div", { class: "list-card" }, ...sent.map(row))] : null,
    sendBtn), { className: "tall" });
}

// ---------- targets ----------
function targetsTab(client) {
  const wrap = h("div", {});
  const draw = () => {
    const live = client.targets.filter((t) => !t.archived);
    const archived = client.targets.filter((t) => t.archived);
    wrap.replaceChildren(
      live.length ? h("div", { class: "list-card" }, ...live.map((t) => h("button", { class: "target-row", onclick: () => targetSheet(client, t, draw) },
        h("span", { class: `type-dot t-${t.type}` }),
        h("div", { class: "grow" }, h("div", { class: "target-name" }, t.name), h("div", { class: "muted small" }, `${TYPES[t.type].label}${INTERVAL_TYPES.has(t.type) ? ` · ${targetSpec(t)}` : ""}`)),
        icon.chevron())))
        : h("p", { class: "muted center" }, "No targets yet. Add each behavior or skill you measure for this client."),
      h("button", { class: "btn big dashed", onclick: () => targetSheet(client, null, draw) }, icon.plus(), "Add target"),
      archived.length ? h("details", { class: "more" }, h("summary", {}, `Archived targets (${archived.length})`),
        h("div", { class: "list-card" }, ...archived.map((t) => h("button", { class: "target-row archived", onclick: () => targetSheet(client, t, draw) },
          h("span", { class: `type-dot t-${t.type}` }), h("div", { class: "grow" }, t.name), icon.chevron())))) : null,
    );
  };
  draw();
  return wrap;
}

// New target: step 1 picks the data type from the cards, step 2 names it and sets that type's options.
// Editing opens straight on step 2 with the type locked.
export function targetSheet(client, target, onSaved) {
  const editing = !!target;
  let type = target?.type || null;
  const name = h("input", { class: "input", placeholder: "e.g. Elopement, On-task, Hand raising", maxlength: 60, value: target?.name || "" });
  const def = h("textarea", { class: "input", rows: 2, placeholder: "Operational definition (optional, goes in the Excel file)", value: target?.definition || "" });
  const behaviors = h("input", { class: "input", placeholder: "e.g. Elopement, Aggression, Property destruction", maxlength: 300,
    value: (target?.config?.behaviors || []).join(", ") });
  const cfgBox = h("div", {});
  const body = h("div", { class: "stack" });
  const cfg = { ...(target?.config || {}) };
  let panel;

  const drawCfg = () => {
    cfgBox.replaceChildren();
    if (!type) return;
    if (type === "abc") {
      cfgBox.append(field("Behaviors", behaviors, "Separate with commas. Each one becomes a button when you log an ABC, and you can pick more than one if they happen together. Leave empty to use the target name."));
      return;
    }
    const fields = TYPES[type].config;
    if (!fields.length) return;
    for (const [k, v] of Object.entries(TYPES[type].defaults || {})) cfg[k] ??= v;
    cfgBox.append(h("div", { class: "cfg-grid" }, ...fields.map((f) => {
      const F = CONFIG_FIELDS[f];
      const input = h("input", { class: "input", type: "number", inputmode: "numeric", min: F.min, max: F.max, value: cfg[f],
        oninput: (ev) => { cfg[f] = Math.max(F.min, Math.min(F.max, Number(ev.target.value) || 0)); } });
      return field(F.label, input, F.unit);
    })));
    if (INTERVAL_TYPES.has(type)) {
      cfgBox.append(h("div", { class: "chips wrap presets" }, h("span", { class: "muted small" }, "Quick:"),
        ...[10, 15, 30, 60, 300].map((sec) => h("button", { class: "chip", type: "button", onclick: () => { cfg.intervalSec = sec; drawCfg(); } }, sec >= 60 ? `${sec / 60} min` : `${sec} s`))));
    }
  };

  const setTitle = (t) => { const el = panel?.el.querySelector(".sheet-head h2"); if (el) el.textContent = t; };

  const drawPick = () => {
    setTitle("New target · data type");
    const groups = [...new Set(Object.values(TYPES).map((t) => t.group))];
    body.replaceChildren(h("p", { class: "muted small" }, "What kind of data will you take?"),
      ...groups.map((g) => h("div", {},
        h("div", { class: "group-title tight" }, g),
        h("div", { class: "type-grid" }, ...Object.entries(TYPES).filter(([, t]) => t.group === g).map(([k, t]) =>
          h("button", { class: `type-card ${type === k ? "on" : ""}`, type: "button", onclick: () => { type = k; drawDetails(); } },
            h("div", { class: "type-card-title" }, h("span", { class: `type-dot t-${k}` }), t.label),
            h("div", { class: "type-card-blurb" }, t.blurb)))))));
    panel?.el.querySelector(".sheet-body")?.scrollTo(0, 0);
  };

  const save = async () => {
    if (!name.value.trim()) { toast("Give the target a name"); name.focus(); return; }
    const out = { ...cfg };
    if (type === "abc") out.behaviors = [...new Set(behaviors.value.split(",").map((b) => b.trim()).filter(Boolean))];
    if (editing) Object.assign(target, { name: name.value.trim(), definition: def.value.trim(), config: out });
    else client.targets.push(newTarget(name.value, type, out, def.value));
    await db.saveClient(client);
    panel.close();
    onSaved?.(editing ? target : client.targets.at(-1));
  };

  const drawDetails = () => {
    setTitle(editing ? "Edit target" : `New ${TYPES[type].label} target`);
    drawCfg();
    body.replaceChildren(
      h("div", { class: "type-locked" }, h("span", { class: `type-dot t-${type}` }), h("b", {}, TYPES[type].label),
        editing ? null : h("button", { class: "link-btn inline", type: "button", onclick: drawPick }, "Change"),
        h("div", { class: "muted small" }, TYPES[type].blurb)),
      field("Name", name),
      cfgBox,
      field("Definition", def),
      h("button", { class: "btn big primary sticky-action", onclick: save }, editing ? "Save changes" : "Add target"),
      editing ? h("button", { class: "btn big ghost", onclick: async () => {
        target.archived = !target.archived;
        await db.saveClient(client);
        panel.close();
        onSaved?.();
        toast(target.archived ? "Archived — past data and graphs are kept" : "Restored");
      } }, target.archived ? "Restore target" : "Archive target") : null,
      editing ? h("p", { class: "muted small center" }, "Changes apply to future sessions. Data type can't be changed once created.") : null);
    panel?.el.querySelector(".sheet-body")?.scrollTo(0, 0);
    if (!editing) setTimeout(() => name.focus(), 50);
  };

  panel = sheet(editing ? "Edit target" : "New target · data type", body, { className: "tall" });
  if (editing) drawDetails(); else drawPick();
}

// ---------- start a session ----------
function startSessionSheet(client) {
  const live = client.targets.filter((t) => !t.archived);
  const picked = new Set(live.map((t) => t.id));
  let periodName = null;
  const list = h("div", {});
  const drawList = () => {
    const targets = client.targets.filter((t) => !t.archived);
    list.replaceChildren(
      targets.length ? h("div", { class: "list-card" }, ...targets.map((t) => h("label", { class: "check-row" },
        h("input", { type: "checkbox", checked: picked.has(t.id), onchange: (ev) => { ev.target.checked ? picked.add(t.id) : picked.delete(t.id); } }),
        h("span", { class: `type-dot t-${t.type}` }),
        h("div", { class: "grow" }, h("div", { class: "target-name" }, t.name), h("div", { class: "muted small" }, targetSpec(t))))))
        : h("p", { class: "muted" }, "This client has no targets yet."),
      h("button", { class: "btn dashed", type: "button", onclick: () => targetSheet(client, null, (t) => { if (t) picked.add(t.id); drawList(); }) }, icon.plus(), "New target"));
  };
  drawList();
  const periods = h("div", { class: "chips wrap" });
  const drawPeriods = () => periods.replaceChildren(...(settings.periods || []).map((p) =>
    h("button", { class: `chip ${periodName === p ? "on" : ""}`, type: "button", onclick: () => { periodName = periodName === p ? null : p; drawPeriods(); } }, p)));
  if (client.periods) drawPeriods();

  sheet(`Start · ${initials(client)}`, (close) => h("div", { class: "stack" },
    h("div", { class: "field-label" }, "Collect data on"),
    list,
    client.periods ? [h("div", { class: "field-label" }, "Period / activity ", h("span", { class: "muted small" }, "(optional — switch any time during the session)")), periods] : null,
    h("button", { class: "btn big primary sticky-action", onclick: async () => {
      const chosen = client.targets.filter((t) => !t.archived && picked.has(t.id));
      if (!chosen.length) { toast("Pick at least one target"); return; }
      const now = Date.now();
      const s = {
        id: uid(), clientId: client.id, status: "active", startedAt: now, endedAt: null,
        observer: settings.observer || "", notes: "",
        segments: [{ s: now }],
        periodLog: periodName ? [{ e: 0, t: now, name: periodName }] : [],
        trackers: chosen.map((t) => ({ targetId: t.id, name: t.name, type: t.type, config: { ...t.config }, definition: t.definition || "", events: [], iv: {} })),
        undo: [],
      };
      await db.saveSession(s);
      close();
      go(`#/s/${s.id}`);
    } }, icon.play(), "Start now")), { className: "tall" });
}

// ======================================================================
// Settings
// ======================================================================
async function settingsView() {
  const info = await db.storageInfo();
  const observer = h("input", { class: "input", value: settings.observer || "", autocomplete: "off" });
  observer.addEventListener("change", async () => { settings.observer = observer.value.trim(); await db.saveSettings(settings); toast("Saved"); });
  const allSessions = await db.getAll("sessions");
  settings.abcStar ??= { a: [], c: [] };
  const abcEditor = (key) => listEditor({
    items: key === "a" ? settings.abcA : settings.abcC,
    starred: settings.abcStar[key],
    labelOf: (x) => parseOption(x).label,
    placeholder: key === "a" ? "Add an antecedent" : "Add a consequence",
    counts: () => usageCounts(allSessions, key),
    onChange: async (items, starred) => {
      settings[key === "a" ? "abcA" : "abcC"] = items;
      settings.abcStar[key] = starred;
      await db.saveSettings(settings);
    },
  });
  const periodsEditor = listEditor({
    items: settings.periods || [], starrable: false, placeholder: "Add a period or activity",
    onChange: async (items) => { settings.periods = items; await db.saveSettings(settings); },
  });

  const fileInput = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const { added, updated } = await db.restore(JSON.parse(await f.text()));
      toast(`Restored: ${added} added, ${updated} updated`, 3500);
      settings = await db.getSettings();
    } catch (err) { toast(err.message || "Couldn't read that file"); }
    ev.target.value = "";
  } });

  root.append(h("main", { class: "view" },
    h("header", { class: "topbar" }, h("button", { class: "back-btn", onclick: () => go("#/") }, icon.back(), "Clients"), h("h1", {}, "Settings")),
    h("section", { class: "card stack" },
      field("Observer name", observer, "Shown on the Excel summary."),
    ),
    h("section", { class: "card stack" },
      h("h2", { class: "card-title" }, "ABC options"),
      h("p", { class: "muted small" }, "The default lists for every client (a client can have its own from its ✎ menu). Drag ⋮⋮ to reorder, ★ keeps an option at the top, tap one to edit it."),
      h("div", { class: "field-label" }, "Antecedents"), abcEditor("a"),
      h("div", { class: "field-label" }, "Consequences"), abcEditor("c"),
      h("p", { class: "field-hint" }, "Add “= escape”, “= attention”, “= tangible” or “= automatic” to a consequence to feed the function hint on the graphs."),
    ),
    h("section", { class: "card stack" },
      h("h2", { class: "card-title" }, "Periods / activities"),
      h("p", { class: "muted small" }, "Used by clients with period tracking turned on (✎ menu on the client). Tap a period during a session to tag the data that follows."),
      periodsEditor,
    ),
    h("section", { class: "card stack" },
      h("h2", { class: "card-title" }, "Backup"),
      h("p", { class: "muted small" }, "All data lives only on this phone. Save a backup now and then (to Files, iCloud Drive or your email) so a lost phone doesn't lose your data. Restoring merges — nothing on this phone is overwritten by older data."),
      h("button", { class: "btn big primary", onclick: async () => {
        const data = await db.backup();
        const name = `ABA Data backup ${new Date().toISOString().slice(0, 10)}.json`;
        const file = new File([JSON.stringify(data)], name, { type: "application/json" });
        const r = await shareFile(file, name).catch(() => (download(file, name), "downloaded"));
        if (r === "retry") toast("Tap Back up again");
      } }, "Back up…"),
      h("button", { class: "btn big", onclick: () => fileInput.click() }, "Restore from backup…"),
      fileInput,
      h("p", { class: "muted small" }, info.persisted ? "✓ Storage is protected from automatic clean-up." : "Tip: add ABA Data to your Home Screen so iOS keeps its data."),
    ),
    h("section", { class: "card stack" },
      h("h2", { class: "card-title" }, "Privacy"),
      h("p", { class: "muted small" }, "Clients are identified by initials only. Nothing is sent anywhere — no accounts, no servers, no analytics. Data leaves the phone only when you email an Excel file or save a backup."),
    ),
    h("p", { class: "muted small center" }, "ABA Data · v", h("span", { id: "app-version" }, "1.8.4"))));
}

// ======================================================================
// Boot
// ======================================================================
// No zooming: this is a tap-fast data tool, and an accidental zoom mid-session costs data.
// iOS ignores user-scalable=no in places, so block pinch (WebKit gesture events) and double-tap here too.
function blockZoom() {
  const stop = (ev) => ev.preventDefault();
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(type, stop, { passive: false });
  document.addEventListener("touchmove", (ev) => { if (ev.touches.length > 1) ev.preventDefault(); }, { passive: false });
  // Double-tap: only cancel the second tap on non-interactive spots, so fast repeat taps on buttons/tiles still count.
  let last = 0;
  document.addEventListener("touchend", (ev) => {
    const now = Date.now();
    const interactive = ev.target.closest?.("button, a, input, textarea, select, label, summary, [contenteditable]");
    if (!interactive && now - last < 350) ev.preventDefault();
    last = now;
  }, { passive: false });
}

async function boot() {
  blockZoom();
  settings = await db.getSettings();
  db.persist();
  // No swipe-back anywhere: iOS starts that gesture from touches at the very left edge and only tells
  // the page after the slide has happened, so those touches are cancelled before it begins. The 16px
  // edge is page gutter, so no buttons live there. (Back arrows in the app still work.)
  document.addEventListener("touchstart", (ev) => {
    if (ev.touches.length === 1 && ev.touches[0].clientX < 16) ev.preventDefault();
  }, { passive: false });
  window.addEventListener("hashchange", route);
  await route();
  // Offline cache everywhere except local development (add ?sw to test it locally).
  const dev = ["localhost", "127.0.0.1"].includes(location.hostname) && !location.search.includes("sw");
  if ("serviceWorker" in navigator && location.protocol !== "file:" && !dev) {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller && !location.hash.startsWith("#/s/")) {
            const b = h("button", { class: "update-banner", onclick: () => location.reload() }, "Update available — tap to reload");
            document.body.append(b);
          }
        });
      });
    }).catch(() => {});
  }
}
boot();
