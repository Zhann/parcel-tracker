import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.13";
import {
  BEHAVIOR_TYPE,
  checkOnce,
  cleanApiKey,
  type Deps,
  follow,
  MAX_FAILURES,
  type MethodContext,
  MIN_GAP_SECONDS,
  model,
  QuotaSpent,
  REPOSITORY_URL,
  requestHeaders,
  RETRY_SECONDS,
  snapshot,
  type Status,
  WAITING_FOR_QUOTA,
} from "./dhl_parcel.ts";
import { HttpError, ParcelNotFound } from "./_lib/dhl.ts";
import { brusselsDay } from "./_lib/format.ts";
import type { Calls } from "./_lib/quota.ts";

const fixture = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/dhl_express_out_for_delivery.json", import.meta.url),
  ),
);

function shipment(statusCode: string, description: string) {
  const body = structuredClone(fixture);
  body.shipments[0].status = { ...body.shipments[0].status, statusCode, description };
  return body;
}

const IN_TRANSIT = shipment("transit", "Arrived at DHL Delivery Facility in GHENT - BELGIUM");
const OUT = shipment("transit", "Shipment is out with courier for delivery");
const DELIVERED = shipment("delivered", "Delivered - Signed for by: RITA RECEIVER");

/**
 * One scripted answer: a body, "fail" a bare 502, "busy" a 429 asking to come
 * back in 15 minutes, "nokey" a 401, "unknown" a 404.
 */
type Look = unknown | "fail" | "busy" | "nokey" | "unknown";

function fakeWorld(script: Look[], start = "2026-11-06T09:00:00Z") {
  let clock = Date.parse(start);
  let i = 0;
  const sleeps: number[] = [];
  const urls: string[] = [];
  const deps: Deps = {
    now: () => new Date(clock),
    sleep: (ms) => {
      sleeps.push(ms / 1000);
      clock += ms;
      return Promise.resolve();
    },
    fetch: (url) => {
      urls.push(url);
      const look = script[Math.min(i++, script.length - 1)];
      if (look === "fail") return Promise.resolve(new Response("down", { status: 502 }));
      if (look === "busy") {
        return Promise.resolve(
          Response.json({ status: 429 }, { status: 429, headers: { "retry-after": "900" } }),
        );
      }
      if (look === "nokey") return Promise.resolve(Response.json({ status: 401 }, { status: 401 }));
      if (look === "unknown") {
        return Promise.resolve(Response.json({ status: 404 }, { status: 404 }));
      }
      return Promise.resolve(Response.json(look));
    },
  };
  return { deps, sleeps, urls, advance: (s: number) => (clock += s * 1000) };
}

/** What every behavior wrote, by behavior id and then data name; fake contexts can share one. */
type Items = Map<string, { spec: string; data: Record<string, unknown> }[]>;
type Datastore = Map<string, Items>;

function fakeContext(
  opts: { datastore?: Datastore; id?: string; dailyBudget?: number } = {},
) {
  const datastore: Datastore = opts.datastore ?? new Map();
  const id = opts.id ?? "dhl-7777777770";
  const own: Items = datastore.get(id) ?? new Map();
  datastore.set(id, own);
  const logs: string[] = [];
  const ctx: MethodContext = {
    modelId: id,
    globalArgs: {
      trackingNumber: "7777777770",
      apiKey: "test-key",
      service: "express",
      postalCode: "",
      label: "Lamp",
      language: "EN",
      dailyBudget: opts.dailyBudget ?? 250,
    },
    logger: {
      info: (m, p) => logs.push(`info ${m} ${JSON.stringify(p)}`),
      warn: (m, p) => logs.push(`warn ${m} ${JSON.stringify(p)}`),
    },
    writeResource: (spec, name, data) => {
      own.set(name, [...(own.get(name) ?? []), { spec, data: structuredClone(data) }]);
      return Promise.resolve({ name });
    },
    readResource: (name) => Promise.resolve(own.get(name)?.at(-1)?.data ?? null),
    // The latest version of every DHL behavior's data, for the specs the predicate names.
    queryData: (predicate) => {
      assert(predicate.includes(`modelType == "${BEHAVIOR_TYPE}"`), predicate);
      const specs = [...predicate.matchAll(/specName == "(\w+)"/g)].map((m) => m[1]);
      const records = [];
      for (const [modelId, items] of datastore) {
        for (const versions of items.values()) {
          const latest = versions.at(-1)!;
          if (specs.includes(latest.spec)) records.push({ modelId, attributes: latest.data });
        }
      }
      return Promise.resolve(records);
    },
  };
  /** Every version this behavior wrote under a data name, oldest first. */
  const store = { get: (name: string) => own.get(name)?.map((v) => v.data) };
  return { ctx, store, logs, datastore };
}

/** Another DHL behavior's data, as if its own method had written it. */
function seed(datastore: Datastore, id: string, spec: string, data: Record<string, unknown>) {
  const items: Items = datastore.get(id) ?? new Map();
  datastore.set(id, items);
  items.set(spec, [...(items.get(spec) ?? []), { spec, data }]);
}

/**
 * One clock for several follows at once: each sleeps on it, and `run` moves
 * it to the earliest waker once every follow still going is asleep. `calls`
 * counts the looks DHL got, by Brussels day.
 */
function sharedWorld(start: string) {
  let clock = Date.parse(start);
  const sleepers: { at: number; wake: () => void }[] = [];
  const calls = new Map<string, number>();
  const deps = (answer: (n: number) => Look): Deps => {
    let n = 0;
    return {
      now: () => new Date(clock),
      sleep: (ms) => new Promise((wake) => sleepers.push({ at: clock + ms, wake })),
      fetch: () => {
        const day = brusselsDay(new Date(clock));
        calls.set(day, (calls.get(day) ?? 0) + 1);
        const look = answer(n++);
        return Promise.resolve(
          look === "fail" ? new Response("down", { status: 502 }) : Response.json(look),
        );
      },
    };
  };
  async function run(tasks: Promise<unknown>[]) {
    let going = tasks.length;
    const all = Promise.all(tasks.map((t) => t.finally(() => going--)));
    while (going > 0) {
      if (sleepers.length < going) {
        await new Promise((tick) => setTimeout(tick, 0));
        continue;
      }
      sleepers.sort((a, b) => a.at - b.at);
      const next = sleepers.shift()!;
      clock = Math.max(clock, next.at);
      next.wake();
    }
    await all;
  }
  return { deps, run, calls };
}

Deno.test("the model's literal type is the one its data is queried by", () => {
  assertEquals(model.type, BEHAVIOR_TYPE);
});

Deno.test("the API key is a sensitive argument", () => {
  const shape = model.globalArguments.shape.apiKey;
  assertEquals(shape.meta()?.sensitive, true);
});

Deno.test("the status expires 30 days on, as DHL's terms ask", () => {
  assertEquals(model.resources.status.lifetime, "30d");
});

Deno.test("a snapshot writes a DHL status that is not following", async () => {
  const { ctx, store } = fakeContext();
  const { deps, urls } = fakeWorld([OUT]);
  const { status } = await checkOnce(ctx, deps, { following: false });
  assertEquals(status.carrier, "dhl");
  assertEquals(status.phase, "out_for_delivery");
  assertEquals(status.label, "Lamp");
  assertEquals(status.window, { day: "2026-11-06", from: "09:00", to: "18:00" });
  assertEquals(status.round, null);
  assertEquals(status.eta, null);
  assertEquals(status.following, false);
  assertEquals(status.nextCheckAt, null);
  assertEquals(store.get("status")?.length, 1);
  assertEquals(new URL(urls[0]).searchParams.get("service"), "express");
  assertEquals(new URL(urls[0]).searchParams.has("recipientPostalCode"), false);
});

Deno.test("follow paces by phase and ends at delivery, without the signer's name", async () => {
  const { ctx, store } = fakeContext();
  const { deps, sleeps } = fakeWorld([IN_TRANSIT, IN_TRANSIT, OUT, OUT, DELIVERED]);
  await follow(ctx, deps, 240);

  assertEquals(sleeps, [1800, 1800, 900, 900]);
  const statuses = store.get("status") as Status[];
  const final = statuses.at(-1)!;
  assertEquals(final.phase, "done");
  assertEquals(final.step.text, "Delivered");
  assertEquals(final.following, false);
  assertEquals(final.nextCheckAt, null);
  assert(!JSON.stringify(statuses).includes("RITA"));
});

Deno.test("follow waits out DHL's 5 seconds after the workflow's snapshot", async () => {
  const { ctx } = fakeContext();
  const world = fakeWorld([OUT, OUT, DELIVERED]);
  await checkOnce(ctx, world.deps, { following: false });
  world.advance(2);
  await follow(ctx, world.deps, 240);
  assertEquals(world.sleeps, [MIN_GAP_SECONDS - 2, 900]);
});

Deno.test("follow keeps the archived flag it finds", async () => {
  const { ctx, store } = fakeContext();
  await ctx.writeResource("status", "status", {
    archived: true,
    checkedAt: "2026-11-01T00:00:00Z",
  });
  const { deps } = fakeWorld([DELIVERED]);
  await follow(ctx, deps, 1);
  assertEquals((store.get("status")!.at(-1) as Status).archived, true);
});

Deno.test("follow retries transient failures five minutes apart, then gives up", async () => {
  const { ctx, logs } = fakeContext();
  const { deps, sleeps } = fakeWorld(["fail", "fail", DELIVERED]);
  await follow(ctx, deps, 240);
  assertEquals(sleeps, [RETRY_SECONDS, RETRY_SECONDS]);
  assertEquals(logs.filter((l) => l.startsWith("warn")).length, 2);

  const broken = fakeWorld(Array(MAX_FAILURES + 1).fill("fail"));
  await assertRejects(() => follow(fakeContext().ctx, broken.deps, 240), Error, "HTTP 502");
});

Deno.test("follow stays away as long as DHL's Retry-After asks", async () => {
  const { ctx, store } = fakeContext();
  const { deps, sleeps } = fakeWorld([OUT, "busy", DELIVERED]);
  await follow(ctx, deps, 240);
  assertEquals(sleeps, [900, 900]);
  const busy = (store.get("status") as Status[])[1];
  assertEquals(busy.error, "DHL answered HTTP 429");
  assertEquals(busy.following, true);
});

Deno.test("a rejected key ends the follow at once, saying so on the status", async () => {
  const { ctx, store } = fakeContext();
  const { deps, sleeps } = fakeWorld([OUT, "nokey"]);
  await assertRejects(() => follow(ctx, deps, 240), HttpError, "check the DHL API key");
  assertEquals(sleeps, [900]);
  const final = store.get("status")!.at(-1) as Status;
  assertEquals(final.following, false);
  assertEquals(final.error, "DHL answered HTTP 401; check the DHL API key in the vault");
});

Deno.test("follow stops at a shipment DHL does not know", async () => {
  const { deps } = fakeWorld(["unknown"]);
  await assertRejects(() => follow(fakeContext().ctx, deps, 240), ParcelNotFound);
});

Deno.test("follow stops at the deadline", async () => {
  const { ctx, store } = fakeContext();
  const { deps, sleeps } = fakeWorld([IN_TRANSIT]);
  await follow(ctx, deps, 2);
  assertEquals(sleeps, [1800, 1800, 1800, 1800]);
  assertEquals((store.get("status")!.at(-1) as Status).following, false);
});

Deno.test("requests carry the key and name the client, and nothing about the user", () => {
  const headers = requestHeaders("test-key");
  assertEquals(headers["dhl-api-key"], "test-key");
  assertEquals(headers["user-agent"], `parcel-tracker/${model.version} (+${REPOSITORY_URL})`);
  assert(!headers["user-agent"].includes("@"));
  assertEquals(headers["accept"], "application/json");
});

Deno.test("cleanApiKey drops what a copy from a web page brings along", () => {
  assertEquals(cleanApiKey("\ufeffabc123"), "abc123");
  assertEquals(cleanApiKey("\u200babc123\n"), "abc123");
  assertEquals(cleanApiKey("  abc123  "), "abc123");
});

Deno.test("cleanApiKey refuses a key no header can carry, without showing it", () => {
  for (const bad of ["abc\u00e9123", "abc 123", "", "\ufeff"]) {
    const err = assertThrows(() => cleanApiKey(bad), Error, "swamp vault put default DHL_API_KEY");
    assert(!bad.trim() || !err.message.includes(bad.trim()));
  }
});

// ── the key's calls a day ──────────────────────────────────────────────────

/** 10:00 in Brussels: 14 hours of the day left. */
const MORNING = "2026-11-06T09:00:00Z";
const TODAY = "2026-11-06";

Deno.test("every look counts: the snapshot, the follow's, a restart's and a retry's", async () => {
  const { ctx, store } = fakeContext();
  const world = fakeWorld([OUT, OUT, DELIVERED, "fail", DELIVERED], MORNING);
  const counted = () => store.get("calls")!.at(-1) as unknown as Calls;

  await snapshot(ctx, world.deps);
  assertEquals(counted(), { day: TODAY, count: 1 });
  world.advance(60);
  await follow(ctx, world.deps, 240);
  assertEquals(counted(), { day: TODAY, count: 3 });
  // A follow started again, whose first look fails and is retried.
  await follow(ctx, world.deps, 240);
  assertEquals(counted(), { day: TODAY, count: 5 });
  assertEquals(world.urls.length, 5);
});

Deno.test("a follow stretches its pace when other follows have used most of the day", async () => {
  const { ctx, store, datastore } = fakeContext();
  const now = Date.parse(MORNING);
  seed(datastore, "dhl-other", "calls", { day: TODAY, count: 149 });
  seed(datastore, "dhl-other", "status", {
    following: true,
    nextCheckAt: new Date(now + 600_000).toISOString(),
  });
  const { deps, sleeps } = fakeWorld([OUT, DELIVERED], MORNING);
  await follow(ctx, deps, 240);
  // 100 calls left after this look, for 2 follows over 14 hours: 50 400 × 2 / 100.
  assertEquals(sleeps, [1008]);
  const first = (store.get("status") as Status[])[0];
  assertEquals(first.nextCheckAt, new Date(now + 1008_000).toISOString());
});

Deno.test("a follow that stopped without saying so takes no share", async () => {
  const { ctx, datastore } = fakeContext();
  seed(datastore, "dhl-other", "calls", { day: TODAY, count: 149 });
  seed(datastore, "dhl-gone", "status", {
    following: true,
    nextCheckAt: new Date(Date.parse(MORNING) - 3600_000).toISOString(),
  });
  const { deps, sleeps } = fakeWorld([OUT, DELIVERED], MORNING);
  await follow(ctx, deps, 240);
  assertEquals(sleeps, [900]);
});

Deno.test("follows started together count each other from their first look", async () => {
  const world = sharedWorld(MORNING);
  const datastore: Datastore = new Map();
  seed(datastore, "dhl-other", "calls", { day: TODAY, count: 246 });
  const follows = [];
  for (let i = 0; i < 3; i++) {
    const { ctx } = fakeContext({ datastore, id: `dhl-${i}` });
    const deps = world.deps(() => OUT);
    follows.push(snapshot(ctx, deps).then(() => follow(ctx, deps, 1)));
  }
  await world.run(follows);
  // The three snapshots make 249. One call is left, and three follows that would each take
  // it if they did not see each other: two hold back, and the last, then alone, takes it.
  assertEquals(246 + world.calls.get(TODAY)!, 250);
});

Deno.test("a look that fails after the wait shows its error, no longer the wait", async () => {
  const { ctx, store, datastore } = fakeContext();
  const { deps } = fakeWorld([OUT, "fail", DELIVERED], MORNING);
  await snapshot(ctx, deps);
  seed(datastore, "dhl-other", "calls", { day: TODAY, count: 249 });
  await follow(ctx, deps, 240);
  const failed = (store.get("status") as Status[]).find((s) => s.error)!;
  assertEquals(failed.error, "DHL answered HTTP 502");
  assertEquals(failed.waiting, null);
});

Deno.test("a spent budget shows as waiting for tomorrow's quota, not as an error", async () => {
  const { ctx, store, datastore } = fakeContext();
  const { deps, sleeps, urls } = fakeWorld([OUT, DELIVERED], MORNING);
  await snapshot(ctx, deps);
  seed(datastore, "dhl-other", "calls", { day: TODAY, count: 249 });
  await follow(ctx, deps, 240);

  // Six seconds after the snapshot, then to a minute past Brussels midnight.
  assertEquals(sleeps, [MIN_GAP_SECONDS, 14 * 3600 - MIN_GAP_SECONDS + 60]);
  // The snapshot's status, the follow saying it started, the wait, the delivery.
  const [, , waiting, delivered] = store.get("status") as Status[];
  assertEquals(waiting.waiting, WAITING_FOR_QUOTA);
  assertEquals(waiting.error, null);
  assertEquals(waiting.following, true);
  assertEquals(waiting.nextCheckAt, "2026-11-06T23:01:00.000Z");
  assertEquals(delivered.phase, "done");
  assertEquals(delivered.waiting, null);
  assertEquals(urls.length, 2);
  assertEquals(store.get("calls")!.at(-1), { day: "2026-11-07", count: 1 });
});

Deno.test("a snapshot with the budget spent does not look", async () => {
  const { ctx, store, datastore } = fakeContext();
  const { deps, urls } = fakeWorld([OUT], MORNING);
  seed(datastore, "dhl-other", "calls", { day: TODAY, count: 250 });

  // A shipment never seen cannot be checked today: the workflow fails, saying why.
  await assertRejects(() => snapshot(ctx, deps), QuotaSpent, "250 DHL calls");
  assertEquals(urls.length, 0);

  // One seen before keeps its status, so the follow after it can wait for tomorrow.
  seed(datastore, "dhl-other", "calls", { day: TODAY, count: 0 });
  await snapshot(ctx, deps);
  seed(datastore, "dhl-other", "calls", { day: TODAY, count: 249 });
  await snapshot(ctx, deps);
  assertEquals(urls.length, 1);
  const kept = store.get("status")!.at(-1) as Status;
  assertEquals(kept.phase, "out_for_delivery");
  assertEquals(kept.waiting, WAITING_FOR_QUOTA);
});

Deno.test("the budget is an argument, 250 unless a key allows more", async () => {
  const args = model.globalArguments.parse({ trackingNumber: "7777777770", apiKey: "k" });
  assertEquals(args.dailyBudget, 250);

  const { ctx, datastore } = fakeContext({ dailyBudget: 1000 });
  seed(datastore, "dhl-other", "calls", { day: TODAY, count: 400 });
  const { deps, urls } = fakeWorld([DELIVERED], MORNING);
  await follow(ctx, deps, 240);
  assertEquals(urls.length, 1);
});

Deno.test("six shipments out for delivery for two days stay within 250 calls a day", async () => {
  const world = sharedWorld("2026-11-05T23:30:00Z");
  const datastore: Datastore = new Map();
  const follows = [];
  for (let i = 0; i < 6; i++) {
    const { ctx } = fakeContext({ datastore, id: `dhl-${i}` });
    // The third shipment's looks fail every other time, and are retried.
    const deps = world.deps((n) => i === 2 && n % 2 === 1 ? "fail" : OUT);
    follows.push(snapshot(ctx, deps).then(() => follow(ctx, deps, 47)));
  }
  await world.run(follows);

  const days = [...world.calls.entries()];
  assertEquals(days.map(([day]) => day), ["2026-11-06", "2026-11-07"]);
  for (const [day, calls] of days) {
    assert(calls <= 250, `${calls} calls on ${day}`);
    // Without a shared budget these would be 576 a day; nor is the day left unused.
    assert(calls >= 200, `only ${calls} calls on ${day}`);
  }
});

Deno.test("shipments started through the day, and restarted, stay within a small budget", async () => {
  const world = sharedWorld("2026-11-05T23:30:00Z");
  const datastore: Datastore = new Map();
  const follows = [];
  for (let i = 0; i < 4; i++) {
    const { ctx } = fakeContext({ datastore, id: `dhl-${i}`, dailyBudget: 40 });
    const deps = world.deps(() => OUT);
    // Each starts i × 3 hours into the day, follows 5 hours, and is restarted twice.
    const run = async () => {
      await deps.sleep(i * 3 * 3600_000);
      for (let restart = 0; restart < 3; restart++) {
        await snapshot(ctx, deps);
        await follow(ctx, deps, 5);
      }
    };
    follows.push(run());
  }
  await world.run(follows);
  for (const [day, calls] of world.calls) assert(calls <= 40, `${calls} calls on ${day}`);
  assert(world.calls.get("2026-11-06")! >= 30, `only ${world.calls.get("2026-11-06")} calls`);
});
