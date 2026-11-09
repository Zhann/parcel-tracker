import { assertEquals } from "jsr:@std/assert@1.0.13";
import {
  callsToday,
  countCall,
  isSpent,
  pacedSeconds,
  type Quota,
  secondsUntilTomorrow,
  TOMORROW_MARGIN_SECONDS,
} from "./quota.ts";

/** Noon in Brussels on a winter day: 43 200 s of the day left. */
const NOON = new Date("2026-11-09T11:00:00Z");

function quota(over: Partial<Quota> = {}): Quota {
  return { budget: 250, used: 0, follows: 1, secondsLeft: 43_200, ...over };
}

Deno.test("a call is counted on the Brussels day it is made", () => {
  assertEquals(countCall(null, NOON), { day: "2026-11-09", count: 1 });
  assertEquals(countCall({ day: "2026-11-09", count: 7 }, NOON), { day: "2026-11-09", count: 8 });
});

Deno.test("the count starts over on a new Brussels day", () => {
  // 23:30 UTC is already half past midnight in Brussels.
  const afterMidnight = new Date("2026-11-09T23:30:00Z");
  assertEquals(countCall({ day: "2026-11-09", count: 200 }, afterMidnight), {
    day: "2026-11-10",
    count: 1,
  });
});

Deno.test("today's calls are every shipment's, without yesterday's", () => {
  const counts = [
    { day: "2026-11-09", count: 40 },
    { day: "2026-11-09", count: 2 },
    { day: "2026-11-08", count: 96 },
    null,
    { day: "2026-11-09" },
  ];
  assertEquals(callsToday(counts, NOON), 42);
});

Deno.test("the day ends at Brussels midnight, in winter and in summer", () => {
  assertEquals(secondsUntilTomorrow(NOON), 43_200);
  assertEquals(secondsUntilTomorrow(new Date("2026-11-09T22:59:30Z")), 30);
  assertEquals(secondsUntilTomorrow(new Date("2026-07-01T21:00:00Z")), 3600);
});

Deno.test("one shipment far from the budget keeps its phase's pace", () => {
  assertEquals(pacedSeconds(900, quota({ used: 10 })), 900);
  assertEquals(pacedSeconds(1800, quota({ used: 10 })), 1800);
});

Deno.test("the pace stretches to share what is left among the follows", () => {
  // 100 calls left for 4 follows over 12 hours: one look each every 28 min 48.
  assertEquals(pacedSeconds(900, quota({ used: 150, follows: 4 })), 1728);
  // The same follows with plenty left keep 15 minutes.
  assertEquals(pacedSeconds(900, quota({ used: 0, follows: 4 })), 900);
});

Deno.test("a slower pace than the share is left alone", () => {
  assertEquals(pacedSeconds(4 * 3600, quota({ used: 150, follows: 4 })), 4 * 3600);
});

Deno.test("with nothing left the next look is after midnight", () => {
  const tomorrow = 43_200 + TOMORROW_MARGIN_SECONDS;
  assertEquals(pacedSeconds(900, quota({ used: 250 })), tomorrow);
  assertEquals(pacedSeconds(900, quota({ used: 260 })), tomorrow);
  // One call left for three follows: none waits past the new day.
  assertEquals(pacedSeconds(900, quota({ used: 249, follows: 3 })), tomorrow);
});

Deno.test("the budget is spent once the calls left are the other follows'", () => {
  assertEquals(isSpent(quota({ used: 249 })), false);
  assertEquals(isSpent(quota({ used: 250 })), true);
  // Three follows that look at the same moment each see 247 and may all look.
  assertEquals(isSpent(quota({ used: 247, follows: 3 })), false);
  assertEquals(isSpent(quota({ used: 248, follows: 3 })), true);
});

Deno.test("a larger budget is honoured", () => {
  assertEquals(isSpent(quota({ budget: 1000, used: 250 })), false);
  assertEquals(pacedSeconds(900, quota({ budget: 1000, used: 150, follows: 4 })), 900);
});
