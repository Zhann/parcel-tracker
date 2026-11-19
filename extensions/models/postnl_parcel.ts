/**
 * A PostNL parcel, followed until it is delivered or picked up.
 *
 * One instance per parcel. `snapshot` looks once; `follow` keeps looking,
 * paced by where the parcel is (see {@link nextCheckSeconds}): every 30
 * minutes in transit, every 10 once it is on its way to the address, hourly
 * at a pickup point, and it returns when the parcel is delivered or picked
 * up. The `@zhann/follow-postnl-parcel` workflow runs the two.
 *
 * PostNL answers only for the barcode together with the delivery address's
 * country and postal code. The country is read from the postal code's shape
 * when it is Belgian, Dutch or from Luxembourg (see `countryOf`), and must be
 * given otherwise.
 *
 * The ETA is PostNL's own window: there is no postman's round to count stops
 * on, so the `status` resource's `round` and `eta` stay null.
 *
 * Nothing about the receiver is written: no name, no street, no e-mail or
 * phone hash (see `_lib/postnl.ts`).
 *
 * @module
 */
import { z } from "npm:zod@4";
import {
  countryOf,
  type FetchFn,
  HttpError,
  type Language,
  nextCheckSeconds,
  ParcelNotFound,
  trackParcel,
} from "./_lib/postnl.ts";
import { type Status, StatusSchema } from "./_lib/status.ts";

/**
 * The behavior type, for queries over this behavior's data. `model.type` repeats
 * it as a literal, which is what the registry catalog reads.
 */
export const BEHAVIOR_TYPE = "@zhann/postnl-parcel";

/** One parcel: its barcode, where it goes, and how to show it. */
const GlobalArgsSchema = z.object({
  itemCode: z.string().regex(/^[A-Za-z0-9]{8,40}$/).describe(
    "The PostNL barcode of the parcel, such as 3SABCD123456789.",
  ),
  postalCode: z.string().regex(/^[A-Za-z0-9 -]{3,10}$/).describe(
    "The delivery address's postal code. PostNL answers nothing without it.",
  ),
  country: z.string().regex(/^([A-Za-z]{2})?$/).default("").describe(
    "The delivery address's country, as two letters. Empty reads it from the postal code: " +
      "1234 AB is NL, 1234 BE, L-1234 LU.",
  ),
  label: z.string().default("").describe(
    "A name for the parcel in the TUI. Empty shows the sender.",
  ),
  language: z.enum(["EN", "NL", "FR", "DE"]).default("EN").describe(
    "Language of PostNL's texts. Picked up at a pickup point is only recognised in English " +
      "and Dutch.",
  ),
});

/** The parsed global arguments of one parcel. */
type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

export type { Status };

/** The slice of swamp's method context this behavior uses. */
export interface MethodContext {
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
  fetch: FetchFn;
  now: () => Date;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** A look that hangs this long fails, and is retried like any other failure. */
const FETCH_TIMEOUT_MS = 30_000;

/** Where the code lives, so PostNL can see who is asking and how to reach them. */
export const REPOSITORY_URL = "https://github.com/zhann/parcel-tracker";

/**
 * Headers on every request to PostNL: a User-Agent naming this client, its
 * version and the repository. Nothing about whoever runs it.
 */
export function requestHeaders(): Record<string, string> {
  return {
    "accept": "application/json",
    "user-agent": `parcel-tracker/${model.version} (+${REPOSITORY_URL})`,
  };
}

/** The real network, clock and an abortable sleep. */
export const realDeps: Deps = {
  fetch: (url) =>
    fetch(url, {
      headers: requestHeaders(),
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

const STATUS = "status";

/** The postal code says nothing of its country, and none was given. Asking cannot fix it. */
export class CountryUnknown extends Error {
  constructor(postalCode: string) {
    super(
      `postal code ${postalCode} does not say which country it is in; give the country ` +
        `as two letters (--input country=DE)`,
    );
    this.name = "CountryUnknown";
  }
}

/** The delivery country: the one given, else the postal code's. */
export function deliveryCountry(g: Pick<GlobalArgs, "country" | "postalCode">): string {
  const country = g.country ? g.country.toUpperCase() : countryOf(g.postalCode);
  if (!country) throw new CountryUnknown(g.postalCode);
  return country;
}

/** Look once and write the status. Returns it, and the seconds until the next look. */
export async function checkOnce(
  ctx: MethodContext,
  deps: Deps,
  opts: { following: boolean },
): Promise<{ status: Status; handle: { name: string }; waitSeconds: number | null }> {
  const g = ctx.globalArgs;
  const parcel = await trackParcel(
    g.itemCode,
    g.postalCode,
    deliveryCountry(g),
    g.language as Language,
    deps.fetch,
  );
  const now = deps.now();
  const prev = await ctx.readResource(STATUS) as Status | null;

  const wait = nextCheckSeconds(parcel.phase);
  const status: Status = {
    carrier: "postnl",
    itemCode: parcel.itemCode,
    label: g.label,
    product: parcel.product,
    sender: parcel.sender,
    weightGrams: parcel.weightGrams,
    phase: parcel.phase,
    step: parcel.step,
    window: parcel.window,
    roundName: null,
    events: parcel.events,
    round: null,
    eta: null,
    archived: prev?.archived ?? false,
    following: opts.following && wait != null,
    checkedAt: now.toISOString(),
    nextCheckAt: opts.following && wait != null
      ? new Date(now.getTime() + wait * 1000).toISOString()
      : null,
    error: null,
  };
  const handle = await ctx.writeResource("status", STATUS, status);
  return { status, handle, waitSeconds: wait };
}

/** Consecutive failed looks after which `follow` gives up. */
export const MAX_FAILURES = 30;

/** Seconds before a failed look is tried again, unless PostNL asks for longer. */
export const RETRY_SECONDS = 300;

/**
 * Look, wait, look again until the parcel is done or the deadline passes. A
 * transient failure (network, PostNL 5xx or 429) is logged, shown as the
 * status's `error` and retried five minutes later, or after PostNL's
 * `Retry-After` when that is longer; the next good look clears it. A parcel
 * PostNL does not know, a postal code without a country, or
 * {@link MAX_FAILURES} failures in a row end the follow with the error on a
 * status that is no longer following.
 */
export async function follow(
  ctx: MethodContext,
  deps: Deps,
  maxHours: number,
): Promise<{ name: string }[]> {
  deliveryCountry(ctx.globalArgs); // fail at once, before any look
  ctx.logger.info("following {code} for up to {h} hours", {
    code: ctx.globalArgs.itemCode,
    h: maxHours,
  });
  const deadline = deps.now().getTime() + maxHours * 3600_000;
  let failures = 0;
  let last: Status | null = null;
  let handle: { name: string } = { name: STATUS };

  while (true) {
    let waitSeconds: number | null;
    try {
      const looked = await checkOnce(ctx, deps, { following: true });
      handle = looked.handle;
      last = looked.status;
      failures = 0;
      waitSeconds = looked.waitSeconds;
      ctx.logger.info("{phase}: {text}", { phase: last.phase, text: last.step.text });
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      const error = err instanceof Error ? err.message : String(err);
      const fatal = err instanceof ParcelNotFound || err instanceof CountryUnknown ||
        ++failures >= MAX_FAILURES;
      const retryAfter = err instanceof HttpError ? err.retryAfterSeconds : null;
      waitSeconds = Math.max(RETRY_SECONDS, retryAfter ?? 0);
      ctx.logger.warn("look {n} failed: {error}; trying again in {wait} s", {
        n: failures,
        error,
        wait: waitSeconds,
      });
      last ??= await ctx.readResource(STATUS) as Status | null;
      if (last) {
        last = fatal ? { ...last, error, following: false, nextCheckAt: null } : {
          ...last,
          error,
          nextCheckAt: new Date(deps.now().getTime() + waitSeconds * 1000).toISOString(),
        };
        handle = await ctx.writeResource("status", STATUS, last);
      }
      if (fatal) throw err;
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
 * The `@zhann/postnl-parcel` behavior: one instance per parcel, with the
 * `snapshot`, `follow`, `archive` and `unarchive` methods.
 */
export const model = {
  type: "@zhann/postnl-parcel",
  version: "2026.11.19.1",
  reports: ["@zhann/parcel-report"],
  globalArguments: GlobalArgsSchema,
  resources: {
    status: {
      description: "The parcel as last seen: PostNL's step, its window, the timeline, " +
        "and whether a follow is running.",
      schema: StatusSchema,
      lifetime: "infinite",
      garbageCollection: 20,
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
