/**
 * The `status` resource every carrier's behavior writes, so the
 * `@zhann/parcel-report` report and the TUI read one shape whoever carries the
 * parcel. Fields a carrier has no data for (a DHL parcel has no postman's
 * round) are null.
 *
 * @module
 */
import { z } from "npm:zod@4";

/** The carriers a status can come from. A status without one is bpost's. */
export const CARRIERS = ["bpost", "dhl"] as const;

/** A carrier, as the status records it. */
export type Carrier = typeof CARRIERS[number];

/** The carrier's name in words. */
export const CARRIER_WORD: Record<Carrier, string> = { bpost: "bpost", dhl: "DHL" };

/** The carrier of a status; one written before carriers were recorded is bpost's. */
export function carrierOf(s: { carrier?: Carrier }): Carrier {
  return s.carrier ?? "bpost";
}

/** One timeline event. */
export const EventSchema = z.object({
  at: z.string(),
  location: z.string().nullable(),
  text: z.string(),
});

/** One look at a live round. */
export const RoundSampleSchema = z.object({
  at: z.string(),
  stops: z.number(),
  progress: z.number().nullable(),
  distanceKm: z.number().nullable(),
});

const PaceSchema = z.object({ p25: z.number(), p50: z.number(), p75: z.number() });

/** The ETA worked out from a round's stop counts. */
export const EtaSchema = z.object({
  stops: z.number(),
  anchor: z.string(),
  pace: PaceSchema,
  basis: z.enum(["live", "live+history", "history", "prior"]),
  intervals: z.number(),
  earliest: z.string(),
  likely: z.string(),
  latest: z.string(),
});

/**
 * The `status` resource: the parcel as last seen, with the round's latest
 * sample and the ETA while a round is live.
 */
export const StatusSchema = z.object({
  carrier: z.enum(CARRIERS).optional(),
  itemCode: z.string(),
  label: z.string(),
  product: z.string().nullable(),
  sender: z.string().nullable(),
  weightGrams: z.number().nullable(),
  phase: z.enum(["in_transit", "out_for_delivery", "at_pickup_point", "returning", "done"]),
  step: z.object({
    name: z.string().nullable(),
    knownProcessStep: z.string().nullable(),
    text: z.string(),
  }),
  /** The carrier's own delivery window; `from` equal to `to` is a "by" time, both empty a day. */
  window: z.object({ day: z.string(), from: z.string(), to: z.string() }).nullable(),
  roundName: z.string().nullable(),
  events: z.array(EventSchema),
  round: RoundSampleSchema.nullable(),
  eta: EtaSchema.nullable(),
  archived: z.boolean(),
  following: z.boolean(),
  checkedAt: z.string(),
  nextCheckAt: z.string().nullable(),
  error: z.string().nullable(),
  /** Why no look is being taken for now, in words: a DHL key's calls for the day are spent. */
  waiting: z.string().nullable().optional(),
});

/** The parcel as last seen; the `status` resource's content. */
export type Status = z.infer<typeof StatusSchema>;
