/**
 * A bpost parcel, followed from announcement to the doorstep.
 *
 * One instance per parcel. `snapshot` looks once; `follow` keeps looking,
 * paced by where the parcel is (see {@link nextCheckSeconds}): every 15
 * minutes in transit, every minute once it is out for delivery, every 30
 * seconds while the postman's round is live, and it returns when the parcel
 * is delivered or picked up. The `@zhann/follow-parcel` workflow runs the two.
 *
 * Every look writes the `status` resource, which is what the TUI shows; while
 * the round is live it also appends to that day's `round` resource, whose
 * stop counts over time are where the pace and ETA come from. Earlier rounds
 * of the same round name, kept by any parcel, sharpen the pace until today's
 * round has enough of its own (see `_lib/pace.ts`).
 *
 * Nothing about the receiver is written: no name, no street, no coordinates
 * (see `_lib/bpost.ts`).
 *
 * @module
 */
import { z } from "npm:zod@4";
import {
  type FetchFn,
  type Language,
  nextCheckSeconds,
  ParcelNotFound,
  type ParcelReading,
  type RoundReading,
  trackParcel,
} from "./_lib/bpost.ts";
import { estimate, type Eta, type RoundSample, stopDurations } from "./_lib/pace.ts";
import { brusselsDay } from "./_lib/format.ts";

/**
 * The behavior type, for queries over this behavior's data. `model.type` repeats
 * it as a literal, which is what the registry catalog reads.
 */
export const BEHAVIOR_TYPE = "@zhann/bpost-parcel";

/** One parcel: its tracking code and postal code, and how to show it. */
const GlobalArgsSchema = z.object({
  itemCode: z.string().regex(/^[A-Za-z0-9]{8,40}$/).describe(
    "The bpost tracking code (barcode) of the parcel.",
  ),
  postalCode: z.string().regex(/^[A-Za-z0-9 -]{3,10}$/).describe(
    "The delivery address's postal code. bpost answers nothing without it.",
  ),
  label: z.string().default("").describe(
    "A name for the parcel in the TUI. Empty shows the sender.",
  ),
  language: z.enum(["EN", "NL", "FR", "DE"]).default("EN").describe(
    "Language of bpost's step and event texts.",
  ),
});

/** The parsed global arguments of one parcel. */
type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

const EventSchema = z.object({
  at: z.string(),
  location: z.string().nullable(),
  text: z.string(),
});

const RoundSampleSchema = z.object({
  at: z.string(),
  stops: z.number(),
  progress: z.number().nullable(),
  distanceKm: z.number().nullable(),
});

const PaceSchema = z.object({ p25: z.number(), p50: z.number(), p75: z.number() });

const EtaSchema = z.object({
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
 * sample and the ETA while the round is live.
 */
const StatusSchema = z.object({
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
});

/** The parcel as last seen; the `status` resource's content. */
export type Status = z.infer<typeof StatusSchema>;

/** The `round` resource: one delivery day's stop counts over time. */
const RoundSchema = z.object({
  roundName: z.string().nullable(),
  day: z.string(),
  samples: z.array(RoundSampleSchema),
});

/** One delivery day's round; the `round` resource's content. */
export type Round = z.infer<typeof RoundSchema>;

/** The slice of swamp's method context this behavior uses. */
export interface MethodContext {
  globalArgs: GlobalArgs;
  signal?: AbortSignal;
  modelId: string;
  logger: {
    info: (msg: string, props?: Record<string, unknown>) => void;
    warn: (msg: string, props?: Record<string, unknown>) => void;
  };
  writeResource: (
    specName: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<{ name: string }>;
  readResource: (name: string) => Promise<Record<string, unknown> | null>;
  queryData: (predicate: string) => Promise<unknown[]>;
}

/** What `follow` needs from the outside world, swapped out in tests. */
export interface Deps {
  fetch: FetchFn;
  now: () => Date;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** A look that hangs this long fails, and is retried like any other failure. */
const FETCH_TIMEOUT_MS = 30_000;

/** The real network, clock and an abortable sleep. */
export const realDeps: Deps = {
  fetch: (url) =>
    fetch(url, {
      headers: { "accept": "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }),
  now: () => new Date(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const t = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(signal!.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

export { brusselsDay };

const STATUS = "status";
const roundInstance = (day: string) => `round-${day}`;

/**
 * Seconds-per-stop durations from every other kept round of this round name.
 * A round name that is not plain text is not put into a query.
 */
export async function historyDurations(
  ctx: Pick<MethodContext, "queryData" | "modelId">,
  roundName: string | null,
  excludeInstance: string,
): Promise<number[]> {
  if (!roundName || !/^[\w .-]+$/.test(roundName)) return [];
  const records = await ctx.queryData(
    `modelType == "${BEHAVIOR_TYPE}" && specName == "round" && attributes.roundName == "${roundName}"`,
  ) as Array<{ modelId?: string; name?: string; attributes?: Round }>;
  return records
    .filter((r) => !(r.modelId === ctx.modelId && r.name === excludeInstance))
    .flatMap((r) => stopDurations(r.attributes?.samples ?? []));
}

/** Cache of history durations per round name, refreshed every 30 minutes. */
export type HistoryCache = Map<string, { at: number; durations: number[] }>;

/**
 * Look once: fetch, append the round sample when the round is live, recompute
 * the ETA, write the status. Returns what the follow loop paces itself by.
 */
export async function checkOnce(
  ctx: MethodContext,
  deps: Deps,
  opts: { following: boolean; history?: HistoryCache },
): Promise<{
  status: Status;
  parcel: ParcelReading;
  round: RoundReading | null;
  handle: { name: string };
}> {
  const g = ctx.globalArgs;
  const { parcel, round } = await trackParcel(
    g.itemCode,
    g.postalCode,
    g.language as Language,
    deps.fetch,
  );
  const now = deps.now();
  const prev = await ctx.readResource(STATUS) as Status | null;

  let sample: RoundSample | null = null;
  let eta: Eta | null = null;
  if (round) {
    const day = brusselsDay(now);
    const instance = roundInstance(day);
    const kept = await ctx.readResource(instance) as Round | null;
    sample = { at: now.toISOString(), ...round };
    const samples = [...(kept?.samples ?? []), sample];
    await ctx.writeResource(
      "round",
      instance,
      {
        roundName: parcel.roundName,
        day,
        samples,
      } satisfies Round,
    );

    const key = parcel.roundName ?? "";
    let cached = opts.history?.get(key);
    if (!cached || now.getTime() - cached.at > 30 * 60_000) {
      cached = {
        at: now.getTime(),
        durations: await historyDurations(ctx, parcel.roundName, instance),
      };
      opts.history?.set(key, cached);
    }
    eta = estimate(samples, cached.durations, now);
  }

  const wait = nextCheckSeconds(parcel.phase, round != null);
  const status: Status = {
    itemCode: parcel.itemCode,
    label: g.label,
    product: parcel.product,
    sender: parcel.sender,
    weightGrams: parcel.weightGrams,
    phase: parcel.phase,
    step: parcel.step,
    window: parcel.window,
    roundName: parcel.roundName,
    events: parcel.events,
    round: sample,
    eta,
    archived: prev?.archived ?? false,
    following: opts.following && wait != null,
    checkedAt: now.toISOString(),
    nextCheckAt: opts.following && wait != null
      ? new Date(now.getTime() + wait * 1000).toISOString()
      : null,
    error: null,
  };
  const handle = await ctx.writeResource("status", STATUS, status);
  return { status, parcel, round, handle };
}

/** Consecutive failed looks after which `follow` gives up. */
export const MAX_FAILURES = 30;

/**
 * Look, wait, look again until the parcel is done or the deadline passes.
 * A transient failure (network, bpost 5xx) is logged, shown as the status's
 * `error` and retried a minute later; the next good look clears it. A parcel
 * bpost no longer knows, or {@link MAX_FAILURES} failures in a row, end the
 * follow with the error on a status that is no longer following.
 */
export async function follow(
  ctx: MethodContext,
  deps: Deps,
  maxHours: number,
): Promise<{ name: string }[]> {
  ctx.logger.info("following {code} for up to {h} hours", {
    code: ctx.globalArgs.itemCode,
    h: maxHours,
  });
  const deadline = deps.now().getTime() + maxHours * 3600_000;
  const history: HistoryCache = new Map();
  let failures = 0;
  let last: Status | null = null;
  let handle: { name: string } = { name: STATUS };

  while (true) {
    let waitSeconds: number | null;
    try {
      const looked = await checkOnce(ctx, deps, { following: true, history });
      const { status, round } = looked;
      handle = looked.handle;
      last = status;
      failures = 0;
      waitSeconds = nextCheckSeconds(status.phase, round != null);
      ctx.logger.info("{phase}: {text}{stops}", {
        phase: status.phase,
        text: status.step.text,
        stops: status.round ? ` (${status.round.stops} stops)` : "",
      });
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      const error = err instanceof Error ? err.message : String(err);
      const fatal = err instanceof ParcelNotFound || ++failures >= MAX_FAILURES;
      ctx.logger.warn("look {n} failed: {error}", { n: failures, error });
      last ??= await ctx.readResource(STATUS) as Status | null;
      if (last) {
        last = fatal ? { ...last, error, following: false, nextCheckAt: null } : {
          ...last,
          error,
          nextCheckAt: new Date(deps.now().getTime() + 60_000).toISOString(),
        };
        handle = await ctx.writeResource("status", STATUS, last);
      }
      if (fatal) throw err;
      waitSeconds = 60;
    }

    if (waitSeconds == null) break;
    if (deps.now().getTime() + waitSeconds * 1000 > deadline) {
      ctx.logger.info("stopping: followed for {h} hours", { h: maxHours });
      break;
    }
    await deps.sleep(waitSeconds * 1000, ctx.signal);
  }

  if (last?.following) {
    last = { ...last, following: false, nextCheckAt: null };
    handle = await ctx.writeResource("status", STATUS, last);
  }
  return [handle];
}

async function setArchived(ctx: MethodContext, archived: boolean) {
  const status = await ctx.readResource(STATUS) as Status | null;
  if (!status) throw new Error("no status yet: run snapshot or follow first");
  const handle = await ctx.writeResource("status", STATUS, { ...status, archived });
  ctx.logger.info(archived ? "archived {code}" : "unarchived {code}", { code: status.itemCode });
  return handle;
}

/**
 * The `@zhann/bpost-parcel` behavior: one instance per parcel, with the
 * `snapshot`, `follow`, `archive` and `unarchive` methods.
 */
export const model = {
  type: "@zhann/bpost-parcel",
  version: "2026.11.06.3",
  upgrades: [
    {
      toVersion: "2026.11.06.2",
      description: "Adds the @zhann/parcel-report report; arguments unchanged.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
    {
      toVersion: "2026.11.06.3",
      description: "Stops showing bpost's round progress as a percentage; arguments unchanged.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
  ],
  reports: ["@zhann/parcel-report"],
  globalArguments: GlobalArgsSchema,
  resources: {
    status: {
      description: "The parcel as last seen: step, bpost window, timeline, the round's " +
        "stops left and the ETA, and whether a follow is running.",
      schema: StatusSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    round: {
      description: "One delivery day's round: stop counts over time, the source of " +
        "the pace. Kept so later rounds of the same name can use it.",
      schema: RoundSchema,
      lifetime: "infinite",
      garbageCollection: 3,
    },
  },
  methods: {
    snapshot: {
      description: "Look at the parcel once and write its status.",
      arguments: z.object({}),
      execute: async (_args: Record<string, never>, ctx: MethodContext) => {
        const { status, handle } = await checkOnce(ctx, realDeps, { following: false });
        ctx.logger.info("{phase}: {text}", { phase: status.phase, text: status.step.text });
        return { dataHandles: [handle] };
      },
    },
    follow: {
      description: "Keep looking at the parcel, paced by where it is, until it is " +
        "delivered or picked up, or maxHours pass.",
      arguments: z.object({
        maxHours: z.number().positive().max(24 * 30).default(120).describe(
          "Give up after this many hours.",
        ),
      }),
      execute: async (args: { maxHours: number }, ctx: MethodContext) => ({
        dataHandles: await follow(ctx, realDeps, args.maxHours),
      }),
    },
    archive: {
      description: "Hide the parcel from the TUI's list.",
      arguments: z.object({}),
      execute: async (_args: Record<string, never>, ctx: MethodContext) => ({
        dataHandles: [await setArchived(ctx, true)],
      }),
    },
    unarchive: {
      description: "Show an archived parcel in the TUI's list again.",
      arguments: z.object({}),
      execute: async (_args: Record<string, never>, ctx: MethodContext) => ({
        dataHandles: [await setArchived(ctx, false)],
      }),
    },
  },
};
