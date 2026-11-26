// Data types, defaults and small helpers shared by every screen. No DOM here, so the tests can import it.

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// One entry per data type. `config` lists the settings a target of that type can have.
export const TYPES = {
  frequency: {
    label: "Frequency",
    short: "Count",
    group: "Count & time",
    blurb: "Tap each time the behavior happens. Gives count, rate and time between responses (IRT).",
    config: [],
  },
  duration: {
    label: "Duration",
    short: "Duration",
    group: "Count & time",
    blurb: "Tap to start when the behavior begins, tap again when it ends. Gives total time and % of the session.",
    config: [],
  },
  latency: {
    label: "Latency",
    short: "Latency",
    group: "Count & time",
    blurb: "Tap when you give the instruction, then when the response starts. Gives seconds to respond.",
    config: [],
  },
  pir: {
    label: "Partial interval",
    short: "PIR",
    group: "Interval",
    blurb: "Tap if the behavior happens at any point in the interval. Best for behaviors you want to decrease.",
    config: ["intervalSec", "intervalCount"],
    defaults: { intervalSec: 10, intervalCount: 0 },
  },
  wir: {
    label: "Whole interval",
    short: "WIR",
    group: "Interval",
    blurb: "Each interval counts only if the behavior lasts the whole interval. Tap when it stops. Best for on-task.",
    config: ["intervalSec", "intervalCount"],
    defaults: { intervalSec: 10, intervalCount: 0 },
  },
  mts: {
    label: "Momentary time sampling",
    short: "MTS",
    group: "Interval",
    blurb: "When the screen flashes, look up and answer Yes / No: is the behavior happening right now?",
    config: ["intervalSec", "intervalCount"],
    defaults: { intervalSec: 15, intervalCount: 0 },
  },
  placheck: {
    label: "PLACHECK (group)",
    short: "PLACHECK",
    group: "Interval",
    blurb: "When the screen flashes, count how many students in the group are engaged. Gives % of group engaged.",
    config: ["intervalSec", "intervalCount", "groupSize"],
    defaults: { intervalSec: 60, intervalCount: 0, groupSize: 5 },
  },
  rating: {
    label: "Interval rating",
    short: "Rating",
    group: "Interval",
    blurb: "When the screen flashes, rate the interval from 1 to 5 (e.g. 1 = poor, 5 = excellent).",
    config: ["intervalSec", "intervalCount", "ratingMax"],
    defaults: { intervalSec: 300, intervalCount: 0, ratingMax: 5 },
  },
  abc: {
    label: "ABC",
    short: "ABC",
    group: "Other",
    blurb: "Log the antecedent, behavior and consequence with a few taps each time the behavior happens.",
    config: [],
  },
  compliance: {
    label: "Compliance",
    short: "Compliance",
    group: "Other",
    blurb: "After each instruction, tap Complied, After prompt, or Did not. Gives % compliance.",
    config: ["complyWindowSec"],
    defaults: { complyWindowSec: 10 },
  },
  dbr: {
    label: "Direct Behavior Rating",
    short: "DBR",
    group: "Other",
    blurb: "Rate Academic Engagement, Disruptive and Respectful from 0 to 10, once per period or session.",
    config: [],
  },
};

export const INTERVAL_TYPES = new Set(["pir", "wir", "mts", "placheck", "rating"]);
export const MOMENT_TYPES = new Set(["mts", "placheck", "rating"]); // scored at the end of each interval

export const CONFIG_FIELDS = {
  intervalSec: { label: "Interval length", unit: "seconds", min: 3, max: 3600 },
  intervalCount: { label: "Number of intervals", unit: "0 = until I end the session", min: 0, max: 999 },
  groupSize: { label: "Students in the group", unit: "", min: 1, max: 60 },
  ratingMax: { label: "Rating scale (1 to …)", unit: "", min: 3, max: 10 },
  complyWindowSec: { label: "Seconds allowed to comply", unit: "for your reference", min: 1, max: 120 },
};

export const DBR_ITEMS = [
  { key: "ae", label: "Academic Engagement", hint: "higher is better" },
  { key: "db", label: "Disruptive Behavior", hint: "lower is better" },
  { key: "rs", label: "Respectful", hint: "higher is better" },
];

export const DEFAULT_PERIODS = [
  "Arrival", "Morning meeting", "Math", "ELA", "Science", "Social studies", "Specials",
  "Lunch", "Recess", "Transition", "Small group", "Independent work", "Dismissal",
];

// "= escape" etc. marks the likely function of a consequence for the ABC summary hint.
export const DEFAULT_ABC = {
  a: [
    "Demand / task given", "Transition", "Told no / denied", "Item taken away", "Attention diverted",
    "Unstructured time", "Peer interaction", "Waiting", "Loud / busy room", "Alone / no activity",
  ],
  c: [
    "Demand removed or delayed = escape", "Break given = escape", "Removed from area = escape",
    "Verbal redirect = attention", "Reprimand = attention", "Peer attention = attention",
    "Adult comfort = attention", "Given item / activity = tangible", "Ignored / no change = automatic",
    "Prompted to continue",
  ],
};

export function parseOption(line) {
  const [label, fn] = String(line).split("=").map((s) => s.trim());
  return { label, fn: fn ? fn.toLowerCase() : null };
}

export const defaultSettings = () => ({
  id: "main",
  observer: "",
  periods: [...DEFAULT_PERIODS],
  abcA: [...DEFAULT_ABC.a],
  abcC: [...DEFAULT_ABC.c],
  sort: "school",
});

export function newClient(first, school, label = "") {
  const now = Date.now();
  return {
    id: uid(),
    first: first.trim().toUpperCase().slice(0, 3),
    school: school.trim().toUpperCase().slice(0, 4),
    label: label.trim(),
    createdAt: now,
    updatedAt: now,
    archived: false,
    targets: [],
    phases: [],
  };
}

export function newTarget(name, type, config = {}, definition = "") {
  return {
    id: uid(),
    name: name.trim(),
    type,
    config: { ...(TYPES[type].defaults || {}), ...config },
    definition: definition.trim(),
    archived: false,
  };
}

export const initials = (c) => `${c.first} · ${c.school}`;
export const emailSubject = (c) => `Data Collection - ${c.first} ${c.school}`;

// One-line description of a target's settings, e.g. "MTS · 15 s".
export function targetSpec(t) {
  const T = TYPES[t.type];
  if (!INTERVAL_TYPES.has(t.type)) return T.short;
  const c = t.config || {};
  const len = c.intervalSec >= 60 && c.intervalSec % 60 === 0 ? `${c.intervalSec / 60} min` : `${c.intervalSec} s`;
  return `${T.short} · ${len}${c.intervalCount ? ` × ${c.intervalCount}` : ""}`;
}

// Session time that excludes pauses. segments: [{ s, e? }] in wall-clock ms.
export function activeMs(session, now = Date.now()) {
  let ms = 0;
  for (const seg of session.segments || []) ms += (seg.e ?? (session.endedAt || now)) - seg.s;
  return Math.max(0, ms);
}

export const isRunning = (session) =>
  session.status === "active" && (session.segments || []).some((s) => s.e == null);
