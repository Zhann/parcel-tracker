/**
 * The bpost public tracking API, read and reduced to what the tracker keeps.
 *
 * Two unauthenticated endpoints, the same ones track.bpost.cloud's own page
 * calls:
 *
 * - `/track/items` — the parcel: its step, bpost's delivery window, the round
 *   it is on and the event timeline. Answers `items: []` without the postal
 *   code.
 * - `/track/itemonroundstatus` — only while the postman's round is live: stops
 *   until the parcel, progress, and the van's and the address's coordinates.
 *   bpost's page polls it every 30 seconds; before the round starts it answers
 *   `{"error": "No round status info can be rendered"}`.
 *
 * Both responses carry the receiver's name, street address (inside the
 * delivery-preferences JWT) and home coordinates. None of that is kept: the
 * parse functions below copy out an allow-list, and the coordinates are
 * reduced to a distance before anything is written.
 *
 * @module
 */

export const BPOST_TRACK_API = "https://track.bpost.cloud/track";

export type Language = "EN" | "NL" | "FR" | "DE";

/**
 * Where the parcel is, in the terms the follow loop paces itself by.
 *
 * - `in_transit`: announced, sorted, in the network.
 * - `out_for_delivery`: on a postman's round today (live once stops show).
 * - `at_pickup_point`: waiting in a post point, locker or office.
 * - `returning`: on its way back to the sender.
 * - `done`: delivered, picked up, or back at the sender.
 */
export type Phase =
  | "in_transit"
  | "out_for_delivery"
  | "at_pickup_point"
  | "returning"
  | "done";

export interface TrackedEvent {
  /** Brussels local time, `YYYY-MM-DDTHH:MM`. */
  at: string;
  location: string | null;
  text: string;
}

export interface DeliveryWindow {
  day: string;
  from: string;
  to: string;
}

/** The allow-listed reading of one `/track/items` answer. */
export interface ParcelReading {
  itemCode: string;
  product: string | null;
  sender: string | null;
  weightGrams: number | null;
  phase: Phase;
  step: {
    name: string | null;
    knownProcessStep: string | null;
    text: string;
  };
  window: DeliveryWindow | null;
  roundName: string | null;
  /** Most recent first, as bpost lists them. */
  events: TrackedEvent[];
}

/** The allow-listed reading of one live `/track/itemonroundstatus` answer. */
export interface RoundReading {
  stops: number;
  /** 0..1 along the round towards this parcel, when bpost gives one. */
  progress: number | null;
  /** Van to delivery address, as the crow flies. */
  distanceKm: number | null;
}

export class ParcelNotFound extends Error {
  constructor(itemCode: string) {
    super(
      `bpost knows no parcel ${itemCode} for that postal code; ` +
        `check both (bpost answers nothing without the right postal code)`,
    );
    this.name = "ParcelNotFound";
  }
}

/**
 * bpost answered something other than 2xx. A 429 or 503 may say, in
 * `Retry-After`, how long to stay away; `retryAfterSeconds` holds that, or
 * null when it did not say.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    path: string,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`bpost answered HTTP ${status} for ${path}`);
    this.name = "HttpError";
  }
}

/**
 * Seconds a `Retry-After` value asks for: either delay-seconds or an HTTP
 * date (RFC 9110 §10.2.3). Null when absent or unreadable; never negative.
 */
export function parseRetryAfter(value: string | null, now: Date = new Date()): number | null {
  if (value == null) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  if (!/^[A-Za-z]{3},? /.test(v)) return null; // HTTP dates start with the weekday
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

// deno-lint-ignore no-explicit-any
type Json = any;

function localized(value: Json, lang: Language): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const v = value[lang] ?? value.EN ?? value.NL;
    return typeof v === "string" ? v : null;
  }
  return null;
}

function eventText(key: Json, lang: Language): string {
  if (typeof key === "string") return key;
  const entry = key?.[lang] ?? key?.EN ?? key?.NL;
  return typeof entry?.description === "string" ? entry.description : "";
}

/** The tracker's phase for a bpost step. */
export function phaseOf(
  knownProcessStep: string | null,
  stepName: string | null,
  stepStatus: string | null,
): Phase {
  const known = knownProcessStep ?? "";
  if (/^(DELIVERED|PICKED_UP)/.test(known)) return "done";
  if (stepName === "delivered" && stepStatus !== "upcoming") return "done";
  if (known.startsWith("AVAILABLE_IN")) return "at_pickup_point";
  if (known === "ON_THE_WAY_TO_SENDER") return "returning";
  if (known.startsWith("ON_THE_WAY_TO") || stepName === "out_for_delivery") {
    return "out_for_delivery";
  }
  return "in_transit";
}

/** Read one `/track/items` answer. Throws {@link ParcelNotFound} on none. */
export function parseItems(
  body: Json,
  itemCode: string,
  lang: Language = "EN",
): ParcelReading {
  const item = body?.items?.[0];
  if (!item) throw new ParcelNotFound(itemCode);

  const active = item.activeStep ?? {};
  const overview = item.processOverview?.textKey;
  const stepText = localized(overview?.[lang]?.description, lang) ??
    localized(overview?.EN?.description, lang) ??
    [localized(active.label?.main, lang), localized(active.label?.detail, lang)]
      .filter(Boolean).join(" ");

  const range = item.expectedDeliveryTimeRange;
  const window = range?.day && range?.time1 && range?.time2
    ? { day: range.day, from: range.time1, to: range.time2 }
    : null;

  const events: TrackedEvent[] = (item.events ?? []).map((e: Json) => ({
    at: `${e.date}T${e.time}`,
    location: localized(e.location?.locationName ?? e.location, lang),
    text: eventText(e.key, lang),
  }));

  return {
    itemCode: String(item.itemCode ?? itemCode),
    product: item.productName ?? null,
    sender: item.senderCommercialName ?? item.sender?.commercialName ?? null,
    weightGrams: typeof item.weightInGrams === "number" ? item.weightInGrams : null,
    phase: phaseOf(active.knownProcessStep ?? null, active.name ?? null, active.status ?? null),
    step: {
      name: active.name ?? null,
      knownProcessStep: active.knownProcessStep ?? null,
      text: stepText || (events[0]?.text ?? ""),
    },
    window,
    roundName: item.roundName ?? null,
    events,
  };
}

function firstNumber(value: Json): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function point(loc: Json): { lat: number; lon: number } | null {
  const p = Array.isArray(loc) ? loc[0] : loc;
  const lat = firstNumber(p?.lat);
  const lon = firstNumber(p?.long ?? p?.lon ?? p?.lng);
  return lat == null || lon == null ? null : { lat, lon };
}

/** Great-circle distance in km. */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Read one `/track/itemonroundstatus` answer: null when no round is live.
 * The coordinates are used for the distance and dropped.
 */
export function parseRound(body: Json): RoundReading | null {
  const status = body?.itemOnRoundStatus;
  const stops = firstNumber(status?.nrOfStopsUntilTarget);
  if (!status || stops == null) return null;

  let progress = firstNumber(status.progressUntilTarget);
  if (progress != null && progress > 1) progress = progress / 100;
  if (progress != null && (progress < 0 || progress > 1)) progress = null;

  const van = point(status.lastKnownLocation);
  const target = point(status.targetLocation);
  const distanceKm = van && target ? Math.round(haversineKm(van, target) * 10) / 10 : null;

  return { stops: Math.round(stops), progress, distanceKm };
}

export type FetchFn = (url: string) => Promise<Response>;

function trackUrl(endpoint: string, itemCode: string, postalCode: string) {
  const q = new URLSearchParams({ itemIdentifier: itemCode, postalCode });
  return `${BPOST_TRACK_API}/${endpoint}?${q}`;
}

async function getJson(fetchFn: FetchFn, url: string): Promise<Json> {
  const res = await fetchFn(url);
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(
      res.status,
      new URL(url).pathname,
      parseRetryAfter(res.headers.get("retry-after")),
    );
  }
  return await res.json();
}

/** Fetch and read both endpoints. The round is null before it starts. */
export async function trackParcel(
  itemCode: string,
  postalCode: string,
  lang: Language = "EN",
  fetchFn: FetchFn = fetch,
): Promise<{ parcel: ParcelReading; round: RoundReading | null }> {
  const parcel = parseItems(
    await getJson(fetchFn, trackUrl("items", itemCode, postalCode)),
    itemCode,
    lang,
  );
  let round: RoundReading | null = null;
  if (parcel.phase === "out_for_delivery") {
    round = parseRound(
      await getJson(fetchFn, trackUrl("itemonroundstatus", itemCode, postalCode)),
    );
  }
  return { parcel, round };
}

/**
 * Seconds until the next look, by phase. A live round goes at bpost's own
 * page's 30 seconds; a parcel waiting at a pickup point barely changes.
 */
export function nextCheckSeconds(phase: Phase, roundLive: boolean): number | null {
  switch (phase) {
    case "done":
      return null;
    case "out_for_delivery":
      return roundLive ? 30 : 60;
    case "at_pickup_point":
      return 3600;
    default:
      return 900;
  }
}
