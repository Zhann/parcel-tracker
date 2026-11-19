/**
 * PostNL's public tracking endpoint, read and reduced to what the tracker
 * keeps.
 *
 * One unauthenticated endpoint, the one tracking.postnl.nl's own page calls:
 * `GET /track-and-trace/api/trackAndTrace/<barcode>-<country>-<postal code>`.
 * Without the delivery address's country and postal code it answers
 * `colli: {}`, as if the parcel did not exist. The country can mostly be told
 * from the postal code's shape (see {@link countryOf}).
 *
 * Answers carry the receiver's name and street, twice (`recipient` and
 * `deliveryAddress`), the sender's address and contact person, and hashes of
 * the receiver's e-mail address and phone number. None of that is kept: the
 * parse copies out an allow-list, and of the sender only its company name.
 *
 * The terms this follows are in docs/research/postnl-tos.md.
 *
 * @module
 */
import { localStamp } from "./format.ts";
import { parseRetryAfter } from "./http.ts";
import type { Phase } from "./status.ts";

export { parseRetryAfter };
export type { Phase };

export const POSTNL_TRACK_API = "https://tracking.postnl.nl/track-and-trace/api/trackAndTrace";

export type Language = "EN" | "NL" | "FR" | "DE";

export interface TrackedEvent {
  /** Brussels local time, `YYYY-MM-DDTHH:MM`. */
  at: string;
  /** PostNL gives no place for its events. */
  location: null;
  text: string;
}

export interface DeliveryWindow {
  day: string;
  /** Empty for a whole day; `to` empty for "from" a time. */
  from: string;
  to: string;
}

/** The allow-listed reading of one `trackAndTrace` answer. */
export interface ParcelReading {
  itemCode: string;
  product: string | null;
  sender: string | null;
  weightGrams: number | null;
  phase: Phase;
  step: {
    /** PostNL's stage: `InTransit`, `Delivered`, …; null when it gives none. */
    name: string | null;
    /** The code of the observation the step text comes from, such as `B01`. */
    knownProcessStep: string | null;
    text: string;
  };
  window: DeliveryWindow | null;
  /** Most recent first. */
  events: TrackedEvent[];
}

export class ParcelNotFound extends Error {
  constructor(itemCode: string, country?: string) {
    const where = country ? `that postal code in ${country}` : "that postal code and country";
    super(
      `PostNL knows no parcel ${itemCode} for ${where}; check the code and postal code, ` +
        `or give the country as two letters (country=…): PostNL answers nothing without all three`,
    );
    this.name = "ParcelNotFound";
  }
}

/**
 * PostNL answered something other than 2xx. A 429 or 503 may say, in
 * `Retry-After`, how long to stay away; `retryAfterSeconds` holds that, or
 * null when it did not say.
 */
export class HttpError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds: number | null) {
    super(`PostNL answered HTTP ${status}`);
    this.name = "HttpError";
  }
}

// deno-lint-ignore no-explicit-any
type Json = any;

/**
 * The country a postal code's shape gives away: `1234 AB` is Dutch, `L-1234`
 * from Luxembourg, four digits Belgian. Null for any other shape (five digits
 * could be German, French, Italian, …), which then needs the country given.
 */
export function countryOf(postalCode: string): "NL" | "BE" | "LU" | null {
  const pc = postalCode.trim();
  if (/^[1-9]\d{3} ?[A-Z]{2}$/i.test(pc)) return "NL";
  if (/^L-?\d{4}$/i.test(pc)) return "LU";
  if (/^[1-9]\d{3}$/.test(pc)) return "BE";
  return null;
}

/** A postal code as PostNL writes it in the key: `1234AB`, `1234`, `10115`. */
export function normalPostalCode(postalCode: string): string {
  return postalCode.trim().toUpperCase().replace(/^L-?(?=\d{4}$)/, "").replace(/[\s-]+/g, "");
}

/** The request URL for one parcel. */
export function trackUrl(
  itemCode: string,
  postalCode: string,
  country: string,
  language: Language = "EN",
): string {
  const key = `${itemCode.trim().toUpperCase()}-${country.toUpperCase()}-${
    normalPostalCode(postalCode)
  }`;
  return `${POSTNL_TRACK_API}/${encodeURIComponent(key)}?language=${language.toLowerCase()}`;
}

/** Where a parcel goes when PostNL leaves it for someone to fetch. */
const RETAIL = new Set(["ServicePoint", "Collect"]);
/** Where a parcel goes when it goes back. */
const BACK = new Set(["Sender", "Return"]);

const RETURNING =
  /return(ed|ing)? to (the )?sender|being returned|retour|terug naar (de )?afzender/i;
const PICKED_UP = /picked up|collected|opgehaald|afgehaald/i;
/** "Ready to be collected", "kan worden opgehaald": waiting, not fetched. */
const READY = /ready|klaar|available|can be|to be (picked|collected)|kan worden/i;

/**
 * The tracker's phase for PostNL's status. PostNL counts its steps 0 to 4:
 * announced, received, sorted, on its way to the address, delivered. Where it
 * goes (`deliveryAddressType`) tells a pickup point and a return apart; a
 * parcel at a pickup point counts as delivered there, so being picked up is
 * read from the text, in English or Dutch, unless it says the parcel is ready
 * to be fetched.
 */
export function phaseOf(
  index: number | null,
  addressType: string | null,
  text: string,
  hasRetailLocation = false,
): Phase {
  const retail = RETAIL.has(addressType ?? "") ||
    (addressType === "Rerouted" && hasRetailLocation);
  const back = BACK.has(addressType ?? "") || RETURNING.test(text);
  if ((index ?? 0) >= 4) {
    const pickedUp = PICKED_UP.test(text) && !READY.test(text);
    return retail && !back && !pickedUp ? "at_pickup_point" : "done";
  }
  if (back) return "returning";
  if (index === 3 && !retail) return "out_for_delivery";
  return "in_transit";
}

/**
 * PostNL's estimate as a window. A whole day, or a span of days, is just the
 * (last) day; "from" a time has no end.
 */
export function windowOf(eta: Json): DeliveryWindow | null {
  const start = localStamp(eta?.start);
  const end = localStamp(eta?.end);
  switch (eta?.type) {
    case "Specific":
      if (start && end && start.day === end.day) {
        return { day: end.day, from: start.time, to: end.time };
      }
      return end ? { day: end.day, from: "", to: "" } : null;
    case "WholeDay":
      return start ? { day: start.day, from: "", to: "" } : null;
    case "OnlyFromTime":
      return start ? { day: start.day, from: start.time, to: "" } : null;
    case "MultipleDaySpan":
      return end ? { day: end.day, from: "", to: "" } : null;
    default:
      return null;
  }
}

const SHIPMENT_TYPE: Record<string, string> = {
  Parcel: "Parcel",
  LetterboxParcel: "Letterbox parcel",
  Letter: "Letter",
};

interface Observation {
  at: number;
  code: string | null;
  event: TrackedEvent;
}

function observationOf(o: Json): Observation | null {
  const stamp = localStamp(o?.observationDate);
  const text = typeof o?.description === "string" ? o.description : "";
  if (!stamp || !text) return null;
  return {
    at: Date.parse(o.observationDate),
    code: typeof o.observationCode === "string" ? o.observationCode : null,
    event: { at: `${stamp.day}T${stamp.time}`, location: null, text },
  };
}

/**
 * Read one `trackAndTrace` answer. Throws {@link ParcelNotFound}, naming the
 * `country` asked for, on none.
 */
export function parseColli(body: Json, itemCode: string, country?: string): ParcelReading {
  const colli = body?.colli ?? {};
  const collo = colli[itemCode.toUpperCase()] ?? Object.values(colli)[0];
  if (!collo) throw new ParcelNotFound(itemCode, country);

  // The page shows a few observations; the full list is under analyticsInfo.
  const all = collo.analyticsInfo?.allObservations;
  const raw = Array.isArray(all) && all.length ? all : collo.observations ?? [];
  const observations = (Array.isArray(raw) ? raw : [])
    .map(observationOf)
    .filter((o): o is Observation => o != null)
    .sort((a, b) => b.at - a.at);

  const message = collo.statusPhase?.message;
  const text = typeof message === "string" && message ? message : observations[0]?.event.text ?? "";
  const source = observations.find((o) => o.event.text === text) ?? observations[0];
  const index = typeof collo.statusPhase?.index === "number" ? collo.statusPhase.index : null;
  const addressType = typeof collo.deliveryAddressType === "string"
    ? collo.deliveryAddressType
    : null;
  const stage = collo.analyticsInfo?.shipmentStage;
  const company = collo.sender?.names?.companyName;
  const weight = collo.details?.dimensions?.weight;

  return {
    itemCode: String(collo.barcode ?? itemCode),
    product: SHIPMENT_TYPE[collo.context?.shipmentType] ?? null,
    sender: typeof company === "string" && company ? company : null,
    weightGrams: typeof weight === "number" && weight > 0 ? Math.round(weight) : null,
    phase: phaseOf(index, addressType, text, collo.retailDeliveryLocation != null),
    step: {
      name: typeof stage === "string" && stage ? stage : null,
      knownProcessStep: source?.code ?? null,
      text,
    },
    window: windowOf(collo.eta),
    events: observations.map((o) => o.event),
  };
}

export type FetchFn = (url: string) => Promise<Response>;

/** Fetch and read one parcel. */
export async function trackParcel(
  itemCode: string,
  postalCode: string,
  country: string,
  language: Language,
  fetchFn: FetchFn,
): Promise<ParcelReading> {
  const res = await fetchFn(trackUrl(itemCode, postalCode, country, language));
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(res.status, parseRetryAfter(res.headers.get("retry-after")));
  }
  return parseColli(await res.json(), itemCode, country.toUpperCase());
}

/**
 * Seconds until the next look, by phase. PostNL shows no round to count
 * stops on, only a window that narrows, so there is nothing to gain from
 * looking more often than every 10 minutes on the day.
 */
export function nextCheckSeconds(phase: Phase): number | null {
  switch (phase) {
    case "done":
      return null;
    case "out_for_delivery":
      return 600;
    case "at_pickup_point":
      return 3600;
    default:
      return 1800;
  }
}
