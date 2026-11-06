import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1.0.13";
import {
  choosePace,
  estimate,
  lastDrop,
  LIVE_ONLY_AFTER,
  percentile,
  PRIOR_PACE,
  type RoundSample,
  stopDurations,
} from "./pace.ts";

const T0 = Date.parse("2026-11-06T10:00:00Z");

/** Samples every 30 s from a list of stop counts. */
function series(stops: number[], everySeconds = 30): RoundSample[] {
  return stops.map((s, i) => ({
    at: new Date(T0 + i * everySeconds * 1000).toISOString(),
    stops: s,
    progress: null,
    distanceKm: null,
  }));
}

Deno.test("stopDurations skips the truncated first stop", () => {
  // 10 seen for 1 min (truncated), then 9 for 3 min, 8 for 2 min, then 7.
  const s = series([10, 10, 9, 9, 9, 9, 9, 9, 8, 8, 8, 8, 7]);
  assertEquals(stopDurations(s), [180, 120]);
});

Deno.test("stopDurations splits a double drop", () => {
  const s = series([10, 9, 9, 9, 9, 7]);
  assertEquals(stopDurations(s), [60, 60]);
});

Deno.test("stopDurations drops breaks and restarts on a reorder", () => {
  const lunch = series([10, 9, ...Array(100).fill(9), 8, 8, 7], 30);
  assertEquals(stopDurations(lunch), [60]);
  const reordered = series([10, 9, 9, 12, 12, 11, 11, 10]);
  assertEquals(stopDurations(reordered), [60]);
});

Deno.test("percentile interpolates", () => {
  assertEquals(percentile([1, 2, 3, 4], 0.5), 2.5);
  assertEquals(percentile([5], 0.75), 5);
  assertAlmostEquals(percentile([100, 200, 300, 400, 500], 0.25), 200);
});

Deno.test("choosePace falls back to the prior when thin", () => {
  assertEquals(choosePace([100], []), { pace: PRIOR_PACE, basis: "prior", intervals: 1 });
});

Deno.test("choosePace pools until today's round has enough", () => {
  const history = [300, 300, 300, 300];
  assertEquals(choosePace([60, 60], history).basis, "live+history");
  assertEquals(choosePace([], history).basis, "history");
  const live = Array(LIVE_ONLY_AFTER).fill(60);
  const chosen = choosePace(live, history);
  assertEquals(chosen.basis, "live");
  assertEquals(chosen.pace, { p25: 60, p50: 60, p75: 60 });
});

Deno.test("lastDrop finds when the current count first showed", () => {
  const s = series([5, 5, 4, 4, 4]);
  assertEquals(lastDrop(s)?.at, s[2].at);
  assertEquals(lastDrop([]), null);
});

Deno.test("estimate anchors at the last drop and never says the past", () => {
  // 2-minute stops throughout; count went to 6 at T0+12m.
  const s = series([
    ...Array(4).fill(10),
    ...Array(4).fill(9),
    ...Array(4).fill(8),
    ...Array(4).fill(7),
    ...Array(19).fill(6),
  ]);
  const history = [120, 120, 120];
  const anchor = Date.parse(s[16].at);
  const eta = estimate(s, history, new Date(T0 + 17 * 60_000))!;
  assertEquals(eta.stops, 6);
  assertEquals(eta.anchor, s[16].at);
  assertEquals(eta.basis, "live+history");
  assertEquals(Date.parse(eta.likely), anchor + 6 * 120_000);

  const late = new Date(anchor + 60 * 60_000);
  const lateEta = estimate(s, history, late)!;
  assertEquals(lateEta.earliest, late.toISOString());
  assertEquals(lateEta.latest, late.toISOString());
});
