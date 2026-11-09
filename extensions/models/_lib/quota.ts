/**
 * A DHL key's calls a day, shared by every shipment it follows.
 *
 * DHL counts calls per key, so each `@zhann/dhl-parcel` behavior keeps a
 * `calls` resource with the calls it made on one Brussels day, and reads all
 * of them before each look. From that count a follow does two things:
 *
 * - it stretches its pace so the follows running now share the calls left
 *   until midnight ({@link pacedSeconds});
 * - it does not look once the budget is spent ({@link isSpent}), and waits
 *   for the new day.
 *
 * The count is read and then written without a lock, so follows that look in
 * the same moment do not see each other's call. {@link isSpent} covers that
 * by leaving one call for every other running follow, which a follow is from
 * the moment it starts, if its shipment has a status to say so on. What it
 * does not cover: two `snapshot`s in the same moment as the last call of the
 * day can each take it, and so can a follow started without a snapshot
 * before it. Every shipment judges the shared count by its own `dailyBudget`,
 * so shipments on one key should be given the same one.
 *
 * The day is the Brussels calendar day. DHL does not say when its own day
 * starts; if it differs, DHL's 429 is still retried as before.
 *
 * @module
 */
import { brusselsDay } from "./format.ts";

/** Calls a day DHL gives a new key. */
export const DEFAULT_DAILY_BUDGET = 250;

/** Seconds into the new day before the first look, so the day has surely turned. */
export const TOMORROW_MARGIN_SECONDS = 60;

/** The `calls` resource: the calls one behavior made on one Brussels day. */
export interface Calls {
  day: string;
  count: number;
}

/** The key's day as one follow sees it before a look. */
export interface Quota {
  /** Calls a day the key allows. */
  budget: number;
  /** Calls made today by every DHL behavior. */
  used: number;
  /** Follows running now, this one included. */
  follows: number;
  /** Seconds until Brussels midnight. */
  secondsLeft: number;
}

/** The count after one more call at `now`; a count from an earlier day starts over. */
export function countCall(prev: Calls | null, now: Date): Calls {
  const day = brusselsDay(now);
  return { day, count: prev?.day === day ? prev.count + 1 : 1 };
}

/** Calls made on `now`'s Brussels day, over every behavior's `calls` resource. */
export function callsToday(counts: unknown[], now: Date): number {
  const day = brusselsDay(now);
  let total = 0;
  for (const c of counts as (Partial<Calls> | null)[]) {
    if (c?.day === day && typeof c.count === "number") total += c.count;
  }
  return total;
}

const TIME_OF_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * Seconds from `now` to Brussels midnight, by the clock on the wall. On the
 * two days the clock changes this is an hour off; a follow that wakes early
 * finds the budget still spent and waits again.
 */
export function secondsUntilTomorrow(now: Date): number {
  const [h, m, s] = TIME_OF_DAY.format(now).split(":").map(Number);
  return 86_400 - (h * 3600 + m * 60 + s);
}

/**
 * Whether this follow has no call left today: the calls left are no more
 * than the other running follows, which may be looking at this very moment.
 */
export function isSpent(q: Quota): boolean {
  return q.used + (q.follows - 1) >= q.budget;
}

/**
 * Seconds until the next look: `wanted` (the phase's pace, or a retry's
 * wait), stretched so that the running follows, each looking this often,
 * use no more than the calls left today. Never past the start of tomorrow,
 * when the count starts over.
 */
export function pacedSeconds(wanted: number, q: Quota): number {
  const tomorrow = q.secondsLeft + TOMORROW_MARGIN_SECONDS;
  const left = q.budget - q.used;
  if (left <= 0) return Math.max(wanted, tomorrow);
  const share = Math.ceil(q.secondsLeft * q.follows / left);
  return Math.max(wanted, Math.min(share, tomorrow));
}
