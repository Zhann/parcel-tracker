/**
 * Words and times for a parcel, shared by the `@zhann/parcel-report` report
 * and the TUI. Times are Brussels-local, as bpost's windows and events are;
 * DHL's are converted to it.
 *
 * @module
 */

const TZ = "Europe/Brussels";

/** The phases a parcel goes through, in words. */
export const PHASE_WORD = {
  in_transit: "in transit",
  out_for_delivery: "out for delivery",
  at_pickup_point: "at pickup point",
  returning: "returning",
  done: "delivered",
} as const;

/** An instant as Brussels `HH:MM`. */
export function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** The Brussels calendar day of an instant, `YYYY-MM-DD`. */
export function brusselsDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** `45s`, `2m40`, `1h05`. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

/** A `YYYY-MM-DD` day as `today`, `tomorrow` or `DD/MM`, seen from `now`. */
export function relativeDay(day: string, now: Date): string {
  if (day === brusselsDay(now)) return "today";
  if (day === brusselsDay(new Date(now.getTime() + 86_400_000))) return "tomorrow";
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

/** An event's Brussels-local `YYYY-MM-DDTHH:MM` as `DD/MM HH:MM`. */
export function eventStamp(at: string): string {
  const [day, time] = at.split("T");
  const [, m, d] = day.split("-");
  return `${d}/${m} ${time}`;
}

/** Minutes from `now` until an instant, as `in 35 min` or `any minute`. */
export function fromNow(iso: string, now: Date): string {
  const minutes = Math.round((Date.parse(iso) - now.getTime()) / 60_000);
  return minutes <= 1 ? "any minute" : `in ${minutes} min`;
}

/**
 * A carrier's delivery window, seen from `now`: `today 11:10–14:15`, or
 * `tomorrow by 12:00` when it gives one time, or just the day.
 */
export function windowText(w: { day: string; from: string; to: string }, now: Date): string {
  const day = relativeDay(w.day, now);
  if (!w.from && !w.to) return day;
  if (!w.from || w.from === w.to) return `${day} by ${w.to || w.from}`;
  return `${day} ${w.from}–${w.to}`;
}
