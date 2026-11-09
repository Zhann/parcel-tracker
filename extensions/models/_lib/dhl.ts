/**
 * DHL's Shipment Tracking - Unified API, read and reduced to what the tracker
 * keeps.
 *
 * One endpoint, `GET https://api-eu.dhl.com/track/shipments`, with the
 * caller's key in the `DHL-API-Key` header. It covers Express, Parcel and
 * eCommerce shipments; `service` narrows the search when a number is known to
 * several of them. A new key allows 250 calls a day and one every 5 seconds,
 * across every parcel it follows, so the follow loop paces itself far below
 * bpost's (see {@link nextCheckSeconds}).
 *
 * Answers carry the receiver's and sender's names, the destination address
 * and, after delivery, the name of whoever signed. None of that is kept: the
 * parse below copies out an allow-list, keeps only the town of a location
 * (DHL's `addressLocality` can hold a street), and cuts "signed for by"
 * names out of event texts.
 *
 * The terms this follows are in docs/research/dhl-tos.md.
 *
 * @module
 */
import { brusselsDay, clock } from "./format.ts";
import { parseRetryAfter, type Phase } from "./bpost.ts";

export { parseRetryAfter };
export type { Phase };

export const DHL_TRACK_API = "https://api-eu.dhl.com/track/shipments";

export type Language = "EN" | "NL" | "FR" | "DE";

export interface TrackedEvent {
  /** Brussels local time, `YYYY-MM-DDTHH:MM`; the event's own local time when DHL gives no zone. */
  at: string;
  location: string | null;
  text: string;
}

export interface DeliveryWindow {
  day: string;
  /** Empty, or equal to `to`, when DHL gives a single time or only a day. */
  from: string;
  to: string;
}

/** The allow-listed reading of one `/track/shipments` answer. */
export interface ShipmentReading {
  itemCode: string;
  service: string | null;
  product: string | null;
  sender: string | null;
  weightGrams: number | null;
  phase: Phase;
  step: {
    /** DHL's grouping code: `pre-transit`, `transit`, `delivered`, `failure` or `unknown`. */
    name: string | null;
    knownProcessStep: null;
    text: string;
  };
  window: DeliveryWindow | null;
  /** Most recent first. */
  events: TrackedEvent[];
}

export class ParcelNotFound extends Error {
  constructor(itemCode: string) {
    super(
      `DHL knows no shipment ${itemCode}; check the number, or give its service ` +
        `(express, parcel-de, ecommerce, …)`,
    );
    this.name = "ParcelNotFound";
  }
}

/**
 * DHL answered something other than 2xx. A 429 may say, in `Retry-After`, how
 * long to stay away; `retryAfterSeconds` holds that, or null when it did not
 * say. `fatal` is true for answers that trying again cannot fix: a rejected
 * key (401, 403) or a request DHL cannot read (400).
 */
export class HttpError extends Error {
  readonly fatal: boolean;
  constructor(
    readonly status: number,
    detail: string | null,
    readonly retryAfterSeconds: number | null,
  ) {
    const why = status === 401 || status === 403
      ? "; check the DHL API key in the vault"
      : detail
      ? `: ${detail}`
      : "";
    super(`DHL answered HTTP ${status}${why}`);
    this.name = "HttpError";
    this.fatal = status === 400 || status === 401 || status === 403;
  }
}

// deno-lint-ignore no-explicit-any
type Json = any;

const OUT_FOR_DELIVERY =
  /out (with courier )?for delivery|with (the )?delivery courier|onto the delivery vehicle|in delivery/i;
const AT_PICKUP_POINT =
  /(ready|available) for (pick-? ?up|collection)|retail outlet|packstation|parcel ?(shop|locker|station)|service ?point/i;
const RETURNING = /return(ed|ing)? to (the )?(shipper|sender)|being returned/i;

/**
 * The tracker's phase for DHL's latest status. DHL's own code says only
 * whether the shipment is moving or delivered; the rest is read from its
 * English texts, so with another language a parcel out for delivery or at a
 * pickup point shows as in transit.
 */
export function phaseOf(statusCode: string | null, text: string): Phase {
  const returning = RETURNING.test(text);
  if (statusCode === "delivered") {
    return !returning && AT_PICKUP_POINT.test(text) ? "at_pickup_point" : "done";
  }
  if (returning) return "returning";
  if (AT_PICKUP_POINT.test(text)) return "at_pickup_point";
  if (OUT_FOR_DELIVERY.test(text)) return "out_for_delivery";
  return "in_transit";
}

/** An event text without the name of whoever signed for the shipment. */
export function scrubText(text: string): string {
  return text.replace(/\s*[-–:,]?\s*signed for by\b.*$/i, "").trim();
}

/**
 * The town of a DHL location: the last comma-separated part, so no street
 * survives. Express's "HOOFDDORP - NETHERLANDS, THE" loses its trailing
 * article first, or only "THE" would be left.
 */
export function townOf(location: Json): string | null {
  const raw = location?.address?.addressLocality;
  if (typeof raw !== "string") return null;
  const town = raw.replace(/,\s*THE\s*$/i, "").split(",").at(-1)!.trim();
  return town || null;
}

const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * A DHL timestamp as a Brussels day and `HH:MM`. One without a zone is the
 * event's local time and is kept as it is. `midnight` is true when the
 * timestamp is 00:00 in its own zone, which DHL uses for a day with no time.
 */
export function localStamp(
  raw: unknown,
): { day: string; time: string; date: string; midnight: boolean } | null {
  if (typeof raw !== "string") return null;
  const m = STAMP.exec(raw.trim());
  if (!m) return null;
  const [, date, time, zone] = m;
  const midnight = time === "00:00";
  if (!zone) return { day: date, time, date, midnight };
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return null;
  return { day: brusselsDay(at), time: clock(at.toISOString()), date, midnight };
}

/** DHL's estimate as a window: its time frame when it gives one, else its ETA. */
export function windowOf(shipment: Json): DeliveryWindow | null {
  const frame = shipment?.estimatedDeliveryTimeFrame;
  const from = localStamp(frame?.estimatedFrom);
  const through = localStamp(frame?.estimatedThrough);
  if (from && through) {
    const sameDay = from.day === through.day;
    return {
      day: through.day,
      from: from.midnight || !sameDay ? "" : from.time,
      to: through.time,
    };
  }
  const eta = localStamp(shipment?.estimatedTimeOfDelivery);
  if (!eta) return null;
  return eta.midnight
    ? { day: eta.date, from: "", to: "" }
    : { day: eta.day, from: eta.time, to: eta.time };
}

function grams(weight: Json): number | null {
  const v = typeof weight?.value === "number" ? weight.value : null;
  if (v == null) return null;
  const unit = String(weight.unitText ?? "kg").toLowerCase();
  const factor = unit === "g" ? 1 : unit === "lb" || unit === "lbs" ? 453.592 : 1000;
  return Math.round(v * factor);
}

function eventOf(e: Json): TrackedEvent {
  const stamp = localStamp(e?.timestamp);
  const text = typeof e?.description === "string" && e.description
    ? e.description
    : typeof e?.status === "string"
    ? e.status
    : "";
  return {
    at: stamp ? `${stamp.day}T${stamp.time}` : String(e?.timestamp ?? "").slice(0, 16),
    location: townOf(e?.location),
    text: scrubText(text),
  };
}

/** Read one `/track/shipments` answer. Throws {@link ParcelNotFound} on none. */
export function parseShipments(body: Json, itemCode: string): ShipmentReading {
  const shipment = body?.shipments?.[0];
  if (!shipment) throw new ParcelNotFound(itemCode);

  const events = (Array.isArray(shipment.events) ? shipment.events : []).map(eventOf);
  // DHL lists the newest first; make sure, without reordering same-minute events.
  if (events.length > 1 && events[0].at < events.at(-1)!.at) events.reverse();

  const latest = shipment.status ?? shipment.events?.[0] ?? {};
  const statusCode = typeof latest.statusCode === "string" ? latest.statusCode : null;
  const text = eventOf(latest).text || events[0]?.text || "";
  const sender = shipment.details?.sender?.organizationName;

  return {
    itemCode: String(shipment.id ?? itemCode),
    service: typeof shipment.service === "string" ? shipment.service : null,
    product: shipment.details?.product?.productName ?? null,
    sender: typeof sender === "string" && sender ? sender : null,
    weightGrams: grams(shipment.details?.weight),
    phase: phaseOf(statusCode, text),
    step: { name: statusCode, knownProcessStep: null, text },
    window: windowOf(shipment),
    events,
  };
}

export type FetchFn = (url: string) => Promise<Response>;

/** The request URL for one shipment. */
export function trackUrl(
  itemCode: string,
  opts: { service?: string; postalCode?: string; language?: Language } = {},
): string {
  const q = new URLSearchParams({ trackingNumber: itemCode });
  if (opts.service) q.set("service", opts.service);
  if (opts.postalCode) q.set("recipientPostalCode", opts.postalCode);
  q.set("language", (opts.language ?? "EN").toLowerCase());
  return `${DHL_TRACK_API}?${q}`;
}

async function problemDetail(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    return typeof body?.detail === "string" ? body.detail : null;
  } catch {
    return null;
  }
}

/** Fetch and read one shipment. */
export async function trackShipment(
  itemCode: string,
  opts: { service?: string; postalCode?: string; language?: Language },
  fetchFn: FetchFn,
): Promise<ShipmentReading> {
  const res = await fetchFn(trackUrl(itemCode, opts));
  if (res.status === 404) {
    await res.body?.cancel();
    throw new ParcelNotFound(itemCode);
  }
  if (!res.ok) {
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    throw new HttpError(res.status, await problemDetail(res), retryAfter);
  }
  return parseShipments(await res.json(), itemCode);
}

/**
 * Seconds until the next look, by phase. At most 96 looks a day for a parcel
 * out for delivery all day, so a few parcels share a new key's 250.
 */
export function nextCheckSeconds(phase: Phase): number | null {
  switch (phase) {
    case "done":
      return null;
    case "out_for_delivery":
      return 900;
    case "at_pickup_point":
      return 4 * 3600;
    default:
      return 1800;
  }
}
