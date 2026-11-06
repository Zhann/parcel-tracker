/**
 * Pace and ETA from a round's stop count over time.
 *
 * A round sample says how many stops the postman still has before this
 * parcel. Each time the count drops, a stop was done; the time between drops
 * is what a stop takes on this round (driving, parking, the doorbell). The
 * spread of those durations — p25, median, p75 — times the stops left gives
 * the ETA range, anchored at the moment the count last dropped.
 *
 * Today's round alone is thin early on, so until it has
 * {@link LIVE_ONLY_AFTER} durations of its own they are pooled with earlier
 * rounds of the same round name; with fewer than {@link MIN_INTERVALS} in
 * all, a fixed prior stands in and says so.
 *
 * @module
 */

export interface RoundSample {
  /** ISO 8601 instant. */
  at: string;
  stops: number;
  progress: number | null;
  distanceKm: number | null;
}

export interface Pace {
  p25: number;
  p50: number;
  p75: number;
}

export type PaceBasis = "live" | "live+history" | "history" | "prior";

export interface Eta {
  stops: number;
  /** When the stop count last dropped (or first showed). */
  anchor: string;
  pace: Pace;
  basis: PaceBasis;
  /** Seconds-per-stop durations the pace was taken from. */
  intervals: number;
  earliest: string;
  likely: string;
  latest: string;
}

/** Durations longer than this are a break, not a stop. */
export const MAX_STOP_SECONDS = 45 * 60;
/** Fewer durations than this and the prior is used. */
export const MIN_INTERVALS = 3;
/** From this many durations on, today's round is used alone. */
export const LIVE_ONLY_AFTER = 8;
/** What a stop takes when nothing has been seen yet: 2, 3 and 5 minutes. */
export const PRIOR_PACE: Pace = { p25: 120, p50: 180, p75: 300 };

const ms = (iso: string) => new Date(iso).getTime();

/**
 * Seconds per stop between successive drops of the stop count.
 *
 * The first drop is skipped: the count was first seen part-way through a
 * stop, so the time before it is a truncated duration. A drop by n stops in
 * one gap counts as n stops of gap/n. A count that goes up (bpost reordered
 * the round) starts the measurement again.
 */
export function stopDurations(samples: RoundSample[]): number[] {
  const out: number[] = [];
  let anchor: RoundSample | null = null;
  let seenFirstDrop = false;
  for (const s of samples) {
    if (anchor == null) {
      anchor = s;
      continue;
    }
    if (s.stops > anchor.stops) {
      anchor = s;
      seenFirstDrop = false;
      continue;
    }
    if (s.stops < anchor.stops) {
      const n = anchor.stops - s.stops;
      const each = (ms(s.at) - ms(anchor.at)) / 1000 / n;
      if (seenFirstDrop && each > 0 && each <= MAX_STOP_SECONDS) {
        for (let i = 0; i < n; i++) out.push(each);
      }
      seenFirstDrop = true;
      anchor = s;
    }
  }
  return out;
}

/** Linear-interpolated percentile, p in 0..1, of a non-empty list. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** The pace to use, from today's durations and earlier rounds'. */
export function choosePace(
  live: number[],
  history: number[],
): { pace: Pace; basis: PaceBasis; intervals: number } {
  let pool: number[];
  let basis: PaceBasis;
  if (live.length >= LIVE_ONLY_AFTER) {
    pool = live;
    basis = "live";
  } else if (live.length > 0 && history.length > 0) {
    pool = [...live, ...history];
    basis = "live+history";
  } else if (live.length > 0) {
    pool = live;
    basis = "live";
  } else {
    pool = history;
    basis = "history";
  }
  if (pool.length < MIN_INTERVALS) {
    return { pace: PRIOR_PACE, basis: "prior", intervals: pool.length };
  }
  return {
    pace: {
      p25: percentile(pool, 0.25),
      p50: percentile(pool, 0.5),
      p75: percentile(pool, 0.75),
    },
    basis,
    intervals: pool.length,
  };
}

/** When the current stop count first showed. */
export function lastDrop(samples: RoundSample[]): RoundSample | null {
  if (samples.length === 0) return null;
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1].stops === samples[i].stops) i--;
  return samples[i];
}

/**
 * The ETA range for the round as sampled so far, or null without samples.
 * No end of the range is ever before `now`: a late postman is late, not past.
 */
export function estimate(
  samples: RoundSample[],
  history: number[],
  now: Date = new Date(),
): Eta | null {
  const anchor = lastDrop(samples);
  if (!anchor) return null;
  const { pace, basis, intervals } = choosePace(stopDurations(samples), history);
  const stops = anchor.stops;
  const at = (secondsPerStop: number) =>
    new Date(Math.max(now.getTime(), ms(anchor.at) + stops * secondsPerStop * 1000))
      .toISOString();
  return {
    stops,
    anchor: anchor.at,
    pace,
    basis,
    intervals,
    earliest: at(pace.p25),
    likely: at(pace.p50),
    latest: at(pace.p75),
  };
}
