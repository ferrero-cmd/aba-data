// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { activeMs, emailSubject, newClient } from "../js/model.js";
import { eventsByPeriod, intervalInfo, periodExposure, rawTable, summarize } from "../js/summary.js";

const T0 = Date.UTC(2026, 10, 25, 14, 0, 0);
const sec = (n) => n * 1000;
const session = (trackers, minutes = 10, extra = {}) => ({
  id: "s", clientId: "c", status: "done", startedAt: T0, endedAt: T0 + minutes * 60000,
  segments: [{ s: T0, e: T0 + minutes * 60000 }], periodLog: [], trackers, ...extra,
});
const ev = (k, e, more = {}) => ({ k, e, t: T0 + e, p: null, ...more });
const tracker = (type, events = [], config = {}, iv = {}) => ({ targetId: "x", name: type, type, config, events, iv });

test("email subject uses both initials", () => {
  assert.equal(emailSubject(newClient("k", "s")), "Data Collection - K S");
});

test("pauses are excluded from session time", () => {
  const s = { segments: [{ s: 0, e: 60000 }, { s: 120000, e: 180000 }], endedAt: 180000 };
  assert.equal(activeMs(s), 120000);
});

test("frequency: count, rate and IRT", () => {
  const tr = tracker("frequency", [ev("tap", sec(10)), ev("tap", sec(40)), ev("tap", sec(100))]);
  const s = summarize(tr, session([tr], 10));
  assert.equal(s.metrics.find((m) => m.key === "count").value, 3);
  assert.equal(s.metrics.find((m) => m.key === "rateHr").value, 18);
  assert.equal(s.metrics.find((m) => m.key === "irt").value, 45);
});

test("duration: total and percent of session", () => {
  const tr = tracker("duration", [ev("start", sec(0)), ev("stop", sec(60)), ev("start", sec(120)), ev("stop", sec(180))]);
  const s = summarize(tr, session([tr], 10));
  assert.equal(s.metrics[0].value, 20); // 2 of 10 minutes
  assert.equal(s.metrics.find((m) => m.key === "episodes").value, 2);
});

test("latency pairs instruction and response; no-response counted", () => {
  const tr = tracker("latency", [ev("sd", sec(0)), ev("resp", sec(4)), ev("sd", sec(20)), ev("noresp", sec(40)), ev("sd", sec(50)), ev("resp", sec(56))]);
  const s = summarize(tr, session([tr]));
  assert.equal(s.metrics[0].value, 5);
  assert.equal(s.metrics.find((m) => m.key === "trials").value, 3);
});

test("partial interval: only complete intervals are scored", () => {
  const tr = tracker("pir", [], { intervalSec: 10, intervalCount: 0 }, { 0: 1, 2: 1 });
  const s = summarize(tr, session([tr], 0.75)); // 45 s → 4 complete intervals
  assert.equal(intervalInfo(tr, sec(45)).completed, 4);
  assert.equal(s.metrics[0].value, 50);
});

test("whole interval: marked intervals are 'did not occur'", () => {
  const tr = tracker("wir", [], { intervalSec: 10, intervalCount: 4 }, { 1: 0 });
  const s = summarize(tr, session([tr], 5)); // capped at 4 intervals
  assert.equal(s.metrics[0].value, 75);
});

test("MTS: missed moments are excluded from the denominator", () => {
  const tr = tracker("mts", [], { intervalSec: 15, intervalCount: 0 }, { 0: 1, 1: 0, 3: 1 });
  const s = summarize(tr, session([tr], 1)); // 4 intervals, one missed
  assert.equal(s.metrics[0].value, 66.7);
  assert.equal(rawTable(tr, session([tr], 1)).rows[2][4], "Missed");
});

test("PLACHECK averages % engaged", () => {
  const tr = tracker("placheck", [], { intervalSec: 60, groupSize: 5 }, { 0: { engaged: 5, n: 5 }, 1: { engaged: 3, n: 5 } });
  assert.equal(summarize(tr, session([tr], 2)).metrics[0].value, 80);
});

test("compliance percentages", () => {
  const tr = tracker("compliance", [ev("comply", 1), ev("comply", 2), ev("prompted", 3), ev("noncomply", 4)]);
  const s = summarize(tr, session([tr]));
  assert.equal(s.metrics[0].value, 50);
  assert.equal(s.metrics[1].value, 75);
});

test("DBR means per item", () => {
  const tr = tracker("dbr", [ev("dbr", 1, { ae: 6, db: 2, rs: 8 }), ev("dbr", 2, { ae: 8, db: 4, rs: 9 })]);
  const s = summarize(tr, session([tr]));
  assert.deepEqual(s.metrics.map((m) => m.value), [7, 3, 8.5]);
});

test("period exposure and events by period (scatterplot)", () => {
  const tr = tracker("frequency", [ev("tap", sec(30), { p: "Math" }), ev("tap", sec(400), { p: "Recess" }), ev("tap", sec(420), { p: "Recess" })]);
  const s = session([tr], 10, { periodLog: [{ e: 0, name: "Math" }, { e: sec(300), name: "Recess" }] });
  assert.deepEqual(periodExposure(s), { Math: sec(300), Recess: sec(300) });
  assert.deepEqual(eventsByPeriod(tr, s), { Math: 1, Recess: 2 });
});

test("raw tables have a row per event and matching column counts", () => {
  const trackers = [
    tracker("frequency", [ev("tap", 1000), ev("tap", 5000)]),
    tracker("abc", [ev("abc", 1000, { a: "Transition", b: "Elopement", c: "Break given = escape", note: "" })]),
    tracker("rating", [], { intervalSec: 60, ratingMax: 5 }, { 0: 4 }),
  ];
  const s = session(trackers, 2);
  for (const tr of trackers) {
    const { columns, rows } = rawTable(tr, s);
    for (const r of rows) assert.equal(r.length, columns.length, tr.type);
  }
  assert.equal(rawTable(trackers[1], s).rows[0][6], "Break given"); // function tag stripped
});
