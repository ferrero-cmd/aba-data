// On-device storage (IndexedDB). Nothing here ever leaves the phone unless Amanda exports or backs up.
import { defaultSettings } from "./model.js";

const DB_NAME = "aba-data";
const STORES = ["clients", "sessions", "settings"];
let dbp;

function open() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
      const sessions = req.transaction.objectStore("sessions");
      if (!sessions.indexNames.contains("clientId")) sessions.createIndex("clientId", "clientId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function store(name, mode = "readonly") {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const getAll = async (name) => wrap((await store(name)).getAll());
export const get = async (name, id) => wrap((await store(name)).get(id));
export const put = async (name, value) => wrap((await store(name, "readwrite")).put(value));
export const del = async (name, id) => wrap((await store(name, "readwrite")).delete(id));

export async function sessionsFor(clientId) {
  const s = await store("sessions");
  return wrap(s.index("clientId").getAll(clientId));
}

export async function getSettings() {
  return { ...defaultSettings(), ...((await get("settings", "main")) || {}) };
}
export const saveSettings = (s) => put("settings", { ...s, id: "main", updatedAt: Date.now() });

export async function saveClient(c) {
  c.updatedAt = Date.now();
  await put("clients", c);
  return c;
}

export async function saveSession(s) {
  s.updatedAt = Date.now();
  await put("sessions", s);
  return s;
}

export async function deleteClient(id) {
  for (const s of await sessionsFor(id)) await del("sessions", s.id);
  await del("clients", id);
}

// Ask the browser not to clear our data when the phone is low on space.
export async function persist() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

export async function storageInfo() {
  try {
    const [persisted, est] = await Promise.all([navigator.storage?.persisted?.(), navigator.storage?.estimate?.()]);
    return { persisted: !!persisted, usage: est?.usage ?? null };
  } catch { return { persisted: false, usage: null }; }
}

// ---------- backup / restore ----------
export async function backup() {
  return {
    app: "aba-data",
    version: 1,
    exportedAt: new Date().toISOString(),
    clients: await getAll("clients"),
    sessions: await getAll("sessions"),
    settings: await getSettings(),
  };
}

// Settings from a backup: the newer record wins. Backups made before settings were dated fill in
// anything this phone still has at its default (so a new phone gets the old ABC lists, periods and
// observer name even if a sort button was tapped first). Returns the record to save, or null.
const SETTING_KEYS = ["observer", "abcA", "abcC", "abcStar", "periods", "sort"];
export function mergeSettings(mine, theirs) {
  if (!theirs) return null;
  if (!mine) return { ...theirs, id: "main" };
  if ((theirs.updatedAt || 0) > (mine.updatedAt || 0)) return { ...mine, ...theirs, id: "main" };
  const def = defaultSettings();
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const out = { ...mine };
  let changed = false;
  for (const k of SETTING_KEYS) {
    if (theirs[k] === undefined || same(theirs[k], mine[k])) continue;
    if (mine[k] === undefined || same(mine[k], def[k])) { out[k] = theirs[k]; changed = true; }
  }
  return changed ? out : null;
}

// Merge a backup into this phone: anything newer on the phone is kept.
export async function restore(data) {
  if (data?.app !== "aba-data" || !Array.isArray(data.clients) || !Array.isArray(data.sessions)) {
    throw new Error("That file isn't an ABA Data backup.");
  }
  let added = 0;
  let updated = 0;
  for (const [name, rows] of [["clients", data.clients], ["sessions", data.sessions]]) {
    for (const row of rows) {
      if (!row?.id) continue;
      const mine = await get(name, row.id);
      if (!mine) { await put(name, row); added++; }
      else if ((row.updatedAt || 0) > (mine.updatedAt || 0)) { await put(name, row); updated++; }
    }
  }
  if (data.settings) {
    const mine = await get("settings", "main");
    const merged = mergeSettings(mine, data.settings);
    if (merged) await put("settings", merged);
  }
  return { added, updated };
}
