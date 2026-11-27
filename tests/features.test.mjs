// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { abcBehaviors, abcOptions, eventBehaviors, orderOptions, sortByUsage, usageCounts } from "../js/model.js";
import { eventsByPeriod, periodAt, periodExposure, rawTable } from "../js/summary.js";
import { graphData } from "../js/xlsxcharts.js";

const T0 = Date.UTC(2026, 10, 2, 14, 0, 0);
const DAY = 86400000;
const ev = (k, e, more = {}) => ({ k, e, t: T0 + e, ...more });
const ses = (id, day, trackers, extra = {}) => ({
  id, clientId: "c", status: "done", startedAt: T0 + day * DAY, endedAt: T0 + day * DAY + 600000,
  segments: [{ s: T0 + day * DAY, e: T0 + day * DAY + 600000 }], trackers, ...extra,
});

test("ABC behaviors: own list, else the target's own name", () => {
  assert.deepEqual(abcBehaviors({ name: "ABC", config: { behaviors: [" Elopement", "Aggression", "Elopement", ""] } }), ["Elopement", "Aggression"]);
  assert.deepEqual(abcBehaviors({ name: "Elopement", config: {} }), ["Elopement"]);
});

test("ABC events: multiple behaviors kept, old events fall back to b", () => {
  assert.deepEqual(eventBehaviors({ b: "Elopement + Aggression", bs: ["Elopement", "Aggression"] }), ["Elopement", "Aggression"]);
  assert.deepEqual(eventBehaviors({ b: "Elopement" }), ["Elopement"]);
  assert.deepEqual(eventBehaviors({ b: "" }), []);
});

test("starred options come first, list order kept", () => {
  assert.deepEqual(orderOptions(["a", "b", "c", "d"], ["c", "a"]), ["a", "c", "b", "d"]);
});

test("client lists override the global lists", () => {
  const settings = { abcA: ["x", "y"], abcC: ["p", "q"], abcStar: { a: ["y"], c: [] } };
  assert.deepEqual(abcOptions(settings, null), { a: ["y", "x"], c: ["p", "q"] });
  const client = { abc: { a: ["m", "n"], c: ["r"], star: { a: ["n"], c: [] } } };
  assert.deepEqual(abcOptions(settings, client), { a: ["n", "m"], c: ["r"] });
});

test("usage counts and one-off sort by most used", () => {
  const abc = { type: "abc", events: [ev("abc", 1, { a: "Transition", c: "Break given" }), ev("abc", 2, { a: "Waiting", c: "Break given" }), ev("abc", 3, { a: "Waiting" })] };
  const counts = usageCounts([{ trackers: [abc] }], "a");
  assert.equal(counts.get("Waiting"), 2);
  assert.deepEqual(sortByUsage(["Demand", "Transition", "Waiting"], counts), ["Waiting", "Transition", "Demand"]);
  // "= function" suffixes are matched by label
  assert.equal(usageCounts([{ trackers: [abc] }], "c").get("Break given"), 2);
  assert.deepEqual(sortByUsage(["Ignored = automatic", "Break given = escape"], usageCounts([{ trackers: [abc] }], "c")), ["Break given = escape", "Ignored = automatic"]);
});

test("periods: lookup, exposure, per-period counts and Period column", () => {
  const tr = { type: "frequency", name: "Elopement", events: [ev("tap", 1000, { p: "Math" }), ev("tap", 400000, { p: "Recess" }), ev("tap", 500000, { p: "Recess" })] };
  const s = ses("s1", 0, [tr], { periodLog: [{ e: 0, name: "Math" }, { e: 300000, name: "Recess" }] });
  assert.equal(periodAt(s, 100), "Math");
  assert.equal(periodAt(s, 300000), "Recess");
  assert.deepEqual(periodExposure(s), { Math: 300000, Recess: 300000 });
  assert.deepEqual(eventsByPeriod(tr, s), { Math: 1, Recess: 2 });
  const t = rawTable(tr, s);
  assert.deepEqual(t.columns, ["#", "Time", "Session time", "Period", "Seconds since previous (IRT)"]);
  assert.equal(t.rows[1][3], "Recess");
  // No period log → no Period column
  assert.ok(!rawTable(tr, ses("s2", 0, [tr])).columns.includes("Period"));
});

test("graph data: every session to date, split by phase, phase line between sessions", () => {
  const freq = (n) => ({ targetId: "t1", name: "Elopement", type: "frequency", config: {}, events: Array.from({ length: n }, (_, i) => ev("tap", i * 1000)) });
  const all = [ses("a", 0, [freq(2)]), ses("b", 1, [freq(4)]), ses("c", 3, [freq(1)]), ses("d", 4, [freq(3)]), ses("later", 9, [freq(9)])];
  const d3 = new Date(T0 + 3 * DAY);
  const iso = `${d3.getFullYear()}-${String(d3.getMonth() + 1).padStart(2, "0")}-${String(d3.getDate()).padStart(2, "0")}`;
  const client = { targets: [{ id: "t1", name: "Elopement", type: "frequency" }], phases: [{ id: "p", name: "Token board", date: iso, targetIds: [] }] };
  const [b] = graphData(client, [all[3]], all);
  assert.equal(b.rows.length, 4); // "later" is after the exported session
  assert.deepEqual(b.rows.map((r) => r.seg), [0, 0, 1, 1]);
  assert.deepEqual(b.segments.map((x) => x.name), ["Before Token board", "Token board"]);
  assert.deepEqual(b.phaseLines, [{ name: "Token board", x: 2.5 }]);
  assert.deepEqual(b.rows.map((r) => r.inFile), [false, false, false, true]);
  assert.equal(b.rows[1].vals.rateHr, 24); // 4 taps in 10 min
});
