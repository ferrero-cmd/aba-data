// ABA Data — router and the client / target / settings screens.
import * as db from "./db.js";
import { CONFIG_FIELDS, initials, INTERVAL_TYPES, newClient, newTarget, targetSpec, TYPES, uid } from "./model.js";
import { liveSession, sessionSummary } from "./session.js";
import { fmtDate, fmtTime, sessionMs, summarize, fmtClock } from "./summary.js";
import { $, confirmSheet, download, field, h, hueFor, icon, segmented, sheet, shareFile, toast } from "./ui.js";

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
  document.querySelectorAll(".sheet, .sheet-backdrop").forEach((n) => n.remove());
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

const resumeBanner = (s, c) =>
  h("button", { class: "resume-banner", onclick: () => go(`#/s/${s.id}`) },
    h("span", { class: "live-dot" }), h("div", { class: "grow" }, h("b", {}, `Session in progress · ${initials(c)}`),
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
      ? resumeBanner(active, client)
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

function sessionsTab(client, sessions) {
  if (!sessions.length) {
    return h("div", { class: "empty-state small" }, h("p", { class: "muted" },
      client.targets.some((t) => !t.archived) ? "No sessions yet. Tap Start session when you're ready to collect." : "Add target behaviors first, then start a session."),
    client.targets.some((t) => !t.archived) ? null : h("button", { class: "btn", onclick: () => go(`#/c/${client.id}/targets`) }, "Add targets"));
  }
  let month = "";
  return h("div", {}, ...sessions.flatMap((s) => {
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

export function targetSheet(client, target, onSaved) {
  const editing = !!target;
  let type = target?.type || null;
  const name = h("input", { class: "input", placeholder: "e.g. Elopement, On-task, Hand raising", maxlength: 60, value: target?.name || "" });
  const def = h("textarea", { class: "input", rows: 2, placeholder: "Operational definition (optional, goes in the Excel file)", value: target?.definition || "" });
  const cfgBox = h("div", {});
  const typeBox = h("div", {});
  const cfg = { ...(target?.config || {}) };

  const drawCfg = () => {
    cfgBox.replaceChildren();
    if (!type) return;
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
        ...[10, 15, 30, 60, 300].map((s) => h("button", { class: "chip", type: "button", onclick: () => { cfg.intervalSec = s; drawCfg(); } }, s >= 60 ? `${s / 60} min` : `${s} s`))));
    }
  };

  const drawTypes = () => {
    if (editing) {
      typeBox.replaceChildren(h("div", { class: "type-locked" }, h("span", { class: `type-dot t-${type}` }), h("b", {}, TYPES[type].label),
        h("div", { class: "muted small" }, TYPES[type].blurb)));
      return;
    }
    const groups = [...new Set(Object.values(TYPES).map((t) => t.group))];
    typeBox.replaceChildren(...groups.map((g) => h("div", {},
      h("div", { class: "group-title tight" }, g),
      h("div", { class: "type-grid" }, ...Object.entries(TYPES).filter(([, t]) => t.group === g).map(([k, t]) =>
        h("button", { class: `type-card ${type === k ? "on" : ""}`, type: "button", onclick: () => { type = k; drawTypes(); drawCfg(); } },
          h("div", { class: "type-card-title" }, h("span", { class: `type-dot t-${k}` }), t.label),
          h("div", { class: "type-card-blurb" }, t.blurb)))))));
  };
  drawTypes();
  drawCfg();

  sheet(editing ? "Edit target" : "New target", (close) => h("div", { class: "stack" },
    field("Name", name),
    h("div", { class: "field-label" }, "Data type"),
    typeBox,
    cfgBox,
    field("Definition", def),
    h("button", { class: "btn big primary sticky-action", onclick: async () => {
      if (!name.value.trim()) { toast("Give the target a name"); name.focus(); return; }
      if (!type) { toast("Pick a data type"); return; }
      if (editing) Object.assign(target, { name: name.value.trim(), definition: def.value.trim(), config: { ...cfg } });
      else client.targets.push(newTarget(name.value, type, cfg, def.value));
      await db.saveClient(client);
      close();
      onSaved?.(editing ? target : client.targets.at(-1));
    } }, editing ? "Save changes" : "Add target"),
    editing ? h("button", { class: "btn big ghost", onclick: async () => {
      target.archived = !target.archived;
      await db.saveClient(client);
      close();
      onSaved?.();
      toast(target.archived ? "Archived — past data and graphs are kept" : "Restored");
    } }, target.archived ? "Restore target" : "Archive target") : null,
    editing ? h("p", { class: "muted small center" }, "Changes apply to future sessions. Data type can't be changed once created.") : null,
  ), { className: "tall" });
  if (!editing) setTimeout(() => name.focus(), 300);
}

// ---------- start a session ----------
function startSessionSheet(client) {
  const live = client.targets.filter((t) => !t.archived);
  const picked = new Set(live.map((t) => t.id));
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
  sheet(`Start · ${initials(client)}`, (close) => h("div", { class: "stack" },
    h("div", { class: "field-label" }, "Collect data on"),
    list,
    h("button", { class: "btn big primary sticky-action", onclick: async () => {
      const chosen = client.targets.filter((t) => !t.archived && picked.has(t.id));
      if (!chosen.length) { toast("Pick at least one target"); return; }
      const now = Date.now();
      const s = {
        id: uid(), clientId: client.id, status: "active", startedAt: now, endedAt: null,
        observer: settings.observer || "", notes: "",
        segments: [{ s: now }],
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
  const lines = (arr) => arr.join("\n");
  const fromLines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const observer = h("input", { class: "input", value: settings.observer || "", autocomplete: "off" });
  const abcA = h("textarea", { class: "input", rows: 6, value: lines(settings.abcA) });
  const abcC = h("textarea", { class: "input", rows: 6, value: lines(settings.abcC) });
  const save = async () => {
    Object.assign(settings, { observer: observer.value.trim(), abcA: fromLines(abcA.value), abcC: fromLines(abcC.value) });
    await db.saveSettings(settings);
  };
  for (const el of [observer, abcA, abcC]) el.addEventListener("change", () => save().then(() => toast("Saved")));

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
      field("Antecedents", abcA, "One per line."),
      field("Consequences", abcC, "One per line. Add “= escape”, “= attention”, “= tangible” or “= automatic” to feed the function hint on the graphs."),
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
    h("p", { class: "muted small center" }, "ABA Data · v", h("span", { id: "app-version" }, "1.4"))));
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
