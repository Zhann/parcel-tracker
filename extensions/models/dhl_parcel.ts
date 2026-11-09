/**
 * A DHL shipment, followed until it is delivered.
 *
 * One instance per shipment. `snapshot` looks once; `follow` keeps looking,
 * paced by where the shipment is (see {@link nextCheckSeconds}): every 30
 * minutes in transit, every 15 once it is out for delivery, every 4 hours at
 * a pickup point, and it returns when the shipment is delivered. The
 * `@zhann/follow-dhl-parcel` workflow runs the two.
 *
 * DHL's API needs a key (free at developer.dhl.com) and gives a new one 250
 * calls a day, for every shipment followed with it together. Each look, a
 * `snapshot`'s and a retry's too, is counted in the `calls` resource; before
 * a look, every DHL behavior's count for the Brussels day is added up. A
 * follow stretches its pace to share the calls left with the other running
 * follows, and with the `dailyBudget` spent it waits for the new day, its
 * status saying so (see `_lib/quota.ts` for what this does not cover).
 *
 * The ETA is DHL's own: there is no postman's round to count stops on, so
 * the `status` resource's `round` and `eta` stay null, and its `window`
 * holds DHL's estimate.
 *
 * Nothing about the receiver is written (see `_lib/dhl.ts`), and DHL's terms
 * ask for tracking data to go 30 days after delivery: the `status` resource
 * expires 30 days after the last look, which a follow takes at delivery.
 *
 * @module
 */
import { z } from "npm:zod@4";
import {
  type FetchFn,
  HttpError,
  type Language,
  nextCheckSeconds,
  ParcelNotFound,
  trackShipment,
} from "./_lib/dhl.ts";
import {
  type Calls,
  callsToday,
  countCall,
  DEFAULT_DAILY_BUDGET,
  isSpent,
  pacedSeconds,
  type Quota,
  secondsUntilTomorrow,
  TOMORROW_MARGIN_SECONDS,
} from "./_lib/quota.ts";
import { type Status, StatusSchema } from "./_lib/status.ts";

/**
 * The behavior type, for queries over this behavior's data. `model.type` repeats
 * it as a literal, which is what the registry catalog reads.
 */
export const BEHAVIOR_TYPE = "@zhann/dhl-parcel";

/** One shipment: its tracking number, the key to ask with, and how to show it. */
const GlobalArgsSchema = z.object({
  trackingNumber: z.string().regex(/^[A-Za-z0-9-]{6,40}$/).describe(
    "The DHL tracking number (waybill) of the shipment.",
  ),
  apiKey: z.string().min(1).meta({ sensitive: true }).describe(
    "A DHL Shipment Tracking - Unified API key, as ${{ vault.get(<vault>, DHL_API_KEY) }}.",
  ),
  service: z.string().regex(/^([a-z-]{2,30})?$/).default("").describe(
    "DHL's service for the number (express, parcel-de, ecommerce, …). Empty lets DHL find it.",
  ),
  postalCode: z.string().regex(/^([A-Za-z0-9 -]{3,10})?$/).default("").describe(
    "The delivery address's postal code. Optional; only DHL Parcel Germany and Netherlands use it.",
  ),
  label: z.string().default("").describe(
    "A name for the shipment in the TUI. Empty shows the sender.",
  ),
  language: z.enum(["EN", "NL", "FR", "DE"]).default("EN").describe(
    "Language of DHL's texts. Out for delivery and pickup points are only recognised in English.",
  ),
  dailyBudget: z.number().int().positive().default(DEFAULT_DAILY_BUDGET).describe(
    "Calls a day the key allows, shared by every shipment followed with it. A new key has 250.",
  ),
});

/** The parsed global arguments of one shipment. */
type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

export type { Status };

/** The slice of swamp's method context this behavior uses. */
export interface MethodContext {
  /** This behavior's id, to tell its own data from the other shipments'. */
  modelId: string;
  /** The latest data of every behavior that matches a `swamp data query` predicate. */
  queryData: (predicate: string) => Promise<{ modelId: string; attributes: unknown }[]>;
  globalArgs: GlobalArgs;
  signal?: AbortSignal;
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
}

/** What `follow` needs from the outside world, swapped out in tests. */
export interface Deps {
  /** Fetch with the DHL key; the key is added by {@link realDeps}, never by the caller. */
  fetch: FetchFn;
  now: () => Date;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** A look that hangs this long fails, and is retried like any other failure. */
const FETCH_TIMEOUT_MS = 30_000;

/** Where the code lives, so DHL can see who is asking and how to reach them. */
export const REPOSITORY_URL = "https://github.com/zhann/parcel-tracker";

/**
 * Headers on every request to DHL: the key, and a User-Agent naming this
 * client, its version and the repository. Nothing about whoever runs it.
 */
export function requestHeaders(apiKey: string): Record<string, string> {
  return {
    "accept": "application/json",
    "dhl-api-key": apiKey,
    "user-agent": `parcel-tracker/${model.version} (+${REPOSITORY_URL})`,
  };
}

/** Sleep `ms`, or reject as soon as `signal` aborts. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
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
  });
}

/** Whitespace and the invisible marks a copy from a web page brings along. */
const INVISIBLE = /^[\s ​-‍⁠﻿]+|[\s ​-‍⁠﻿]+$/g;

/**
 * The key as DHL takes it: without surrounding whitespace or invisible marks
 * (a byte-order mark or zero-width space from a copy), and refused when
 * anything else in it is not plain ASCII, which no HTTP header can carry. The
 * error never shows the key.
 */
export function cleanApiKey(raw: string): string {
  const key = raw.replace(INVISIBLE, "");
  if (!key || /[^\x21-\x7e]/.test(key)) {
    throw new Error(
      "the DHL API key holds a character that is not plain text; store it again " +
        "with `swamp vault put default DHL_API_KEY` (the API key only, not the secret)",
    );
  }
  return key;
}

/** The real network (asking with `apiKey`), clock and an abortable sleep. */
export function realDeps(apiKey: string): Deps {
  const key = cleanApiKey(apiKey);
  return {
    fetch: (url) =>
      fetch(url, {
        headers: requestHeaders(key),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
    now: () => new Date(),
    sleep: abortableSleep,
  };
}

const STATUS = "status";
const CALLS = "calls";

/** What a status says while its follow waits for the new day's calls. */
export const WAITING_FOR_QUOTA = "waiting for tomorrow's DHL quota";

/** A follow whose next look is this late has stopped, and takes no share of the calls left. */
const FOLLOW_GRACE_MS = 10 * 60_000;

/** Today's calls are spent: nothing was asked of DHL. Not a failure; the new day brings more. */
export class QuotaSpent extends Error {
  constructor(budget: number) {
    super(`today's ${budget} DHL calls are spent; the next look is after midnight`);
    this.name = "QuotaSpent";
  }
}

/**
 * The key's day at `now`: the calls every DHL behavior counted today, and
 * the follows running besides this one, read from their `calls` and `status`
 * resources.
 */
export async function readQuota(ctx: MethodContext, now: Date): Promise<Quota> {
  const [counts, statuses] = await Promise.all([
    ctx.queryData(`modelType == "${BEHAVIOR_TYPE}" && specName == "calls"`),
    ctx.queryData(`modelType == "${BEHAVIOR_TYPE}" && specName == "status"`),
  ]);
  const others = statuses.filter((r) => {
    const s = r.attributes as Partial<Status> | null;
    return r.modelId !== ctx.modelId && s?.following === true && s.nextCheckAt != null &&
      now.getTime() - Date.parse(s.nextCheckAt) < FOLLOW_GRACE_MS;
  });
  return {
    budget: ctx.globalArgs.dailyBudget,
    used: callsToday(counts.map((r) => r.attributes), now),
    follows: others.length + 1,
    secondsLeft: secondsUntilTomorrow(now),
  };
}

/**
 * Look once and write the status. Returns it, and the seconds until the next
 * look (null once delivered), for the follow loop to pace by.
 *
 * The look is counted in the `calls` resource before DHL is asked, so a look
 * that fails counts too. With today's calls spent it throws
 * {@link QuotaSpent} without asking.
 */
export async function checkOnce(
  ctx: MethodContext,
  deps: Deps,
  opts: { following: boolean },
): Promise<{ status: Status; handle: { name: string }; waitSeconds: number | null }> {
  const g = ctx.globalArgs;
  const before = await readQuota(ctx, deps.now());
  if (isSpent(before)) throw new QuotaSpent(before.budget);
  const counted = countCall(await ctx.readResource(CALLS) as Calls | null, deps.now());
  await ctx.writeResource("calls", CALLS, { ...counted });
  const quota = { ...before, used: before.used + 1 };

  const shipment = await trackShipment(
    g.trackingNumber,
    {
      service: g.service || undefined,
      postalCode: g.postalCode || undefined,
      language: g.language as Language,
    },
    deps.fetch,
  );
  const now = deps.now();
  const prev = await ctx.readResource(STATUS) as Status | null;

  const pace = nextCheckSeconds(shipment.phase);
  const wait = pace == null ? null : pacedSeconds(pace, quota);
  const status: Status = {
    carrier: "dhl",
    itemCode: shipment.itemCode,
    label: g.label,
    product: shipment.product,
    sender: shipment.sender,
    weightGrams: shipment.weightGrams,
    phase: shipment.phase,
    step: shipment.step,
    window: shipment.window,
    roundName: null,
    events: shipment.events,
    round: null,
    eta: null,
    archived: prev?.archived ?? false,
    following: opts.following && wait != null,
    checkedAt: now.toISOString(),
    nextCheckAt: opts.following && wait != null
      ? new Date(now.getTime() + wait * 1000).toISOString()
      : null,
    error: null,
    waiting: null,
  };
  const handle = await ctx.writeResource("status", STATUS, status);
  return { status, handle, waitSeconds: wait };
}

/**
 * The `snapshot` method: look once. With today's calls spent, a shipment
 * seen before keeps its status, which then says it is waiting, so the
 * workflow's follow can start and wait for the new day; one never seen
 * fails with {@link QuotaSpent}, since its number cannot be checked today.
 */
export async function snapshot(ctx: MethodContext, deps: Deps): Promise<{ name: string }> {
  try {
    const { status, handle } = await checkOnce(ctx, deps, { following: false });
    ctx.logger.info("{phase}: {text}", { phase: status.phase, text: status.step.text });
    return handle;
  } catch (err) {
    const prev = err instanceof QuotaSpent ? await ctx.readResource(STATUS) as Status | null : null;
    if (!prev) throw err;
    ctx.logger.warn("not looking: {error}", { error: (err as Error).message });
    return await ctx.writeResource("status", STATUS, { ...prev, waiting: WAITING_FOR_QUOTA });
  }
}

/** Consecutive failed looks after which `follow` gives up. */
export const MAX_FAILURES = 30;

/** Seconds before a failed look is tried again, unless DHL asks for longer. */
export const RETRY_SECONDS = 300;

/** DHL allows one call every 5 seconds; a follow never looks sooner than this after the last look. */
export const MIN_GAP_SECONDS = 6;

/**
 * Look, wait, look again until the shipment is delivered or the deadline
 * passes. A transient failure (network, DHL 5xx or 429) is logged, shown as
 * the status's `error` and retried five minutes later, or after DHL's
 * `Retry-After` when that is longer; the next good look clears it. A shipment
 * DHL does not know, a rejected key, or {@link MAX_FAILURES} failures in a row
 * end the follow with the error on a status that is no longer following.
 */
export async function follow(
  ctx: MethodContext,
  deps: Deps,
  maxHours: number,
): Promise<{ name: string }[]> {
  ctx.logger.info("following {code} for up to {h} hours", {
    code: ctx.globalArgs.trackingNumber,
    h: maxHours,
  });
  const deadline = deps.now().getTime() + maxHours * 3600_000;
  let failures = 0;
  let last = await ctx.readResource(STATUS) as Status | null;
  let handle: { name: string } | null = null;

  // The workflow's snapshot looked a moment ago; keep to DHL's one call per 5 s.
  const sinceLast = last ? (deps.now().getTime() - Date.parse(last.checkedAt)) / 1000 : Infinity;
  if (sinceLast < MIN_GAP_SECONDS) {
    await deps.sleep(Math.ceil((MIN_GAP_SECONDS - sinceLast) * 1000), ctx.signal);
  }

  while (true) {
    let waitSeconds: number | null;
    try {
      const looked = await checkOnce(ctx, deps, { following: true });
      const { status } = looked;
      handle = looked.handle;
      last = status;
      failures = 0;
      waitSeconds = looked.waitSeconds;
      ctx.logger.info("{phase}: {text}", { phase: status.phase, text: status.step.text });
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      const error = err instanceof Error ? err.message : String(err);
      if (err instanceof QuotaSpent) {
        waitSeconds = secondsUntilTomorrow(deps.now()) + TOMORROW_MARGIN_SECONDS;
        ctx.logger.info("{error}; looking again in {wait} s", { error, wait: waitSeconds });
        if (last) {
          last = {
            ...last,
            error: null,
            waiting: WAITING_FOR_QUOTA,
            following: true,
            nextCheckAt: new Date(deps.now().getTime() + waitSeconds * 1000).toISOString(),
          };
          handle = await ctx.writeResource("status", STATUS, last);
        }
      } else {
        const fatal = err instanceof ParcelNotFound ||
          (err instanceof HttpError && err.fatal) ||
          ++failures >= MAX_FAILURES;
        const retryAfter = err instanceof HttpError ? err.retryAfterSeconds : null;
        waitSeconds = Math.max(RETRY_SECONDS, retryAfter ?? 0);
        // A retry is a call like any other: it keeps to this follow's share of the day.
        // If the count cannot be read either, the retry's own wait stands.
        const quota = fatal ? null : await readQuota(ctx, deps.now()).catch(() => null);
        if (quota) waitSeconds = pacedSeconds(waitSeconds, quota);
        ctx.logger.warn("look {n} failed: {error}; trying again in {wait} s", {
          n: failures,
          error,
          wait: waitSeconds,
        });
        if (last) {
          last = fatal ? { ...last, error, following: false, nextCheckAt: null } : {
            ...last,
            error,
            following: true,
            nextCheckAt: new Date(deps.now().getTime() + waitSeconds * 1000).toISOString(),
          };
          handle = await ctx.writeResource("status", STATUS, last);
        }
        if (fatal) throw err;
      }
    }

    if (waitSeconds == null) break;
    if (deps.now().getTime() + waitSeconds * 1000 > deadline) {
      ctx.logger.info("stopping: followed for {h} hours", { h: maxHours });
      break;
    }
    await deps.sleep(waitSeconds * 1000, ctx.signal);
  }

  if (last?.following) {
    last = { ...last, following: false, nextCheckAt: null, waiting: null };
    handle = await ctx.writeResource("status", STATUS, last);
  }
  return handle ? [handle] : [];
}
async function setArchived(ctx: MethodContext, archived: boolean) {
  const status = await ctx.readResource(STATUS) as Status | null;
  if (!status) throw new Error("no status yet: run snapshot or follow first");
  const handle = await ctx.writeResource("status", STATUS, { ...status, archived });
  ctx.logger.info(archived ? "archived {code}" : "unarchived {code}", { code: status.itemCode });
  return handle;
}

/**
 * The `@zhann/dhl-parcel` behavior: one instance per shipment, with the
 * `snapshot`, `follow`, `archive` and `unarchive` methods.
 */
export const model = {
  type: "@zhann/dhl-parcel",
  version: "2026.11.08.1",
  reports: ["@zhann/parcel-report"],
  globalArguments: GlobalArgsSchema,
  resources: {
    status: {
      description: "The shipment as last seen: DHL's status, its estimate, the timeline, " +
        "and whether a follow is running. Expires 30 days after the last look, as DHL's terms ask.",
      schema: StatusSchema,
      lifetime: "30d",
      garbageCollection: 20,
    },
    calls: {
      description: "The calls this shipment's looks made to DHL on one Brussels day. Every " +
        "DHL shipment's count is added up before a look, to keep to the key's calls a day.",
      schema: z.object({ day: z.string(), count: z.number() }),
      lifetime: "2d",
      garbageCollection: 3,
    },
  },
  methods: {
    snapshot: {
      description: "Look at the shipment once and write its status.",
      arguments: z.object({}),
      execute: async (_args: Record<string, never>, ctx: MethodContext) => ({
        dataHandles: [await snapshot(ctx, realDeps(ctx.globalArgs.apiKey))],
      }),
    },
    follow: {
      description: "Keep looking at the shipment, paced by where it is, until it is " +
        "delivered or maxHours pass.",
      arguments: z.object({
        maxHours: z.number().positive().max(24 * 30).default(240).describe(
          "Give up after this many hours.",
        ),
      }),
      execute: async (args: { maxHours: number }, ctx: MethodContext) => ({
        dataHandles: await follow(ctx, realDeps(ctx.globalArgs.apiKey), args.maxHours),
      }),
    },
    archive: {
      description: "Hide the shipment from the TUI's list.",
      arguments: z.object({}),
      execute: async (_args: Record<string, never>, ctx: MethodContext) => ({
        dataHandles: [await setArchived(ctx, true)],
      }),
    },
    unarchive: {
      description: "Show an archived shipment in the TUI's list again.",
      arguments: z.object({}),
      execute: async (_args: Record<string, never>, ctx: MethodContext) => ({
        dataHandles: [await setArchived(ctx, false)],
      }),
    },
  },
};
