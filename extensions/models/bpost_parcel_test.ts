import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.13";
import {
  BEHAVIOR_TYPE,
  brusselsDay,
  checkOnce,
  type Deps,
  follow,
  historyDurations,
  MAX_FAILURES,
  type MethodContext,
  model,
  REPOSITORY_URL,
  requestHeaders,
  RETRY_SECONDS,
  type Round,
  type Status,
} from "./bpost_parcel.ts";
import { ParcelNotFound } from "./_lib/bpost.ts";

const fixture = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/items_out_for_delivery.json", import.meta.url)),
);

function items(step: { name: string; knownProcessStep: string; status?: string }) {
  const body = structuredClone(fixture);
  body.items[0].activeStep = { status: "active", ...step };
  return body;
}

const IN_TRANSIT = items({ name: "processing", knownProcessStep: "PROCESSING" });
const OUT = items({ name: "out_for_delivery", knownProcessStep: "ON_THE_WAY_TO_YOU" });
const DELIVERED = items({ name: "delivered", knownProcessStep: "DELIVERED_AT_HOME" });
const NO_ROUND = { error: "No round status info can be rendered" };
const stops = (n: number) => ({ itemOnRoundStatus: { nrOfStopsUntilTarget: [String(n)] } });

/**
 * One scripted look: the items answer and, when asked, the round answer;
 * "fail" is a bare 502, "busy" a 429 asking to come back in 5 minutes.
 */
type Look = [unknown, unknown?] | "fail" | "busy";

function fakeWorld(script: Look[], start = "2026-11-06T09:00:00Z") {
  let clock = Date.parse(start);
  let i = 0;
  let current: Look = script[0];
  const sleeps: number[] = [];
  const deps: Deps = {
    now: () => new Date(clock),
    sleep: (ms) => {
      sleeps.push(ms / 1000);
      clock += ms;
      return Promise.resolve();
    },
    fetch: (url) => {
      const endpoint = new URL(url).pathname.split("/").pop();
      if (endpoint === "items") current = script[Math.min(i++, script.length - 1)];
      if (current === "fail") return Promise.resolve(new Response("down", { status: 502 }));
      if (current === "busy") {
        return Promise.resolve(
          new Response("slow down", { status: 429, headers: { "retry-after": "300" } }),
        );
      }
      const body = endpoint === "items" ? current[0] : current[1] ?? NO_ROUND;
      return Promise.resolve(Response.json(body));
    },
  };
  return { deps, sleeps };
}

function fakeContext(
  extraRounds: Array<{ modelId: string; name: string; attributes: Round }> = [],
) {
  const store = new Map<string, Record<string, unknown>[]>();
  const logs: string[] = [];
  const ctx: MethodContext = {
    globalArgs: {
      itemCode: "323299990000000000000001",
      postalCode: "9050",
      label: "Desk",
      language: "EN",
    },
    modelId: "self",
    logger: {
      info: (m, p) => logs.push(`info ${m} ${JSON.stringify(p)}`),
      warn: (m, p) => logs.push(`warn ${m} ${JSON.stringify(p)}`),
    },
    writeResource: (_spec, name, data) => {
      store.set(name, [...(store.get(name) ?? []), structuredClone(data)]);
      return Promise.resolve({ name });
    },
    readResource: (name) => Promise.resolve(store.get(name)?.at(-1) ?? null),
    queryData: (predicate) => {
      const want = /attributes\.roundName == "([^"]+)"/.exec(predicate)?.[1];
      const own = [...store.entries()]
        .filter(([name]) => name.startsWith("round-"))
        .map(([name, versions]) => ({
          modelId: "self",
          name,
          attributes: versions.at(-1) as Round,
        }));
      return Promise.resolve(
        [...own, ...extraRounds].filter((r) => r.attributes.roundName === want),
      );
    },
  };
  return { ctx, store, logs };
}

Deno.test("the model's literal type is the one its data is queried by", () => {
  assertEquals(model.type, BEHAVIOR_TYPE);
});

Deno.test("brusselsDay uses Brussels time, not UTC", () => {
  assertEquals(brusselsDay(new Date("2026-11-06T23:30:00Z")), "2026-11-07");
});

Deno.test("snapshot-style look writes a status that is not following", async () => {
  const { ctx, store } = fakeContext();
  const { deps } = fakeWorld([[OUT]]);
  const { status } = await checkOnce(ctx, deps, { following: false });
  assertEquals(status.following, false);
  assertEquals(status.nextCheckAt, null);
  assertEquals(status.label, "Desk");
  assertEquals(store.get("status")?.length, 1);
});

Deno.test("follow paces by phase and ends at delivery", async () => {
  const { ctx, store } = fakeContext();
  const { deps, sleeps } = fakeWorld([
    [IN_TRANSIT],
    [OUT, NO_ROUND],
    [OUT, stops(6)],
    [OUT, stops(6)],
    [OUT, stops(5)],
    [OUT, stops(5)],
    [OUT, stops(4)],
    [OUT, stops(4)],
    [OUT, stops(3)],
    [DELIVERED],
  ]);
  await follow(ctx, deps, 120);

  assertEquals(sleeps, [900, 60, 30, 30, 30, 30, 30, 30, 30]);
  const statuses = store.get("status") as Status[];
  const final = statuses.at(-1)!;
  assertEquals(final.phase, "done");
  assertEquals(final.following, false);
  assertEquals(final.nextCheckAt, null);

  const live = statuses.find((s) => s.round?.stops === 3)!;
  assertEquals(live.following, true);
  assert(live.eta, "a live round has an ETA");
  assertEquals(live.eta.stops, 3);
  assertEquals(live.eta.basis, "prior");

  const round = store.get("round-2026-11-06")!.at(-1) as Round;
  assertEquals(round.roundName, "Res-318");
  assertEquals(round.samples.map((s) => s.stops), [6, 6, 5, 5, 4, 4, 3]);
});

Deno.test("follow keeps the archived flag it finds", async () => {
  const { ctx, store } = fakeContext();
  await ctx.writeResource("status", "status", { archived: true });
  const { deps } = fakeWorld([[DELIVERED]]);
  await follow(ctx, deps, 1);
  assertEquals((store.get("status")!.at(-1) as Status).archived, true);
});

Deno.test("follow retries transient failures, then gives up", async () => {
  const { ctx, logs } = fakeContext();
  const { deps, sleeps } = fakeWorld(["fail", "fail", [DELIVERED]]);
  await follow(ctx, deps, 120);
  assertEquals(sleeps, [60, 60]);
  assertEquals(logs.filter((l) => l.startsWith("warn")).length, 2);

  const broken = fakeWorld(Array(MAX_FAILURES + 1).fill("fail"));
  await assertRejects(() => follow(fakeContext().ctx, broken.deps, 120), Error, "HTTP 502");
});

Deno.test("a failed look shows its error until the next good look", async () => {
  const { ctx, store } = fakeContext();
  const { deps } = fakeWorld([[OUT, NO_ROUND], "fail", [DELIVERED]]);
  await follow(ctx, deps, 120);

  const [first, failed, delivered] = store.get("status") as Status[];
  assertEquals(first.error, null);
  assertEquals(failed.error, "bpost answered HTTP 502 for /track/items");
  assertEquals(failed.following, true);
  assertEquals(Date.parse(failed.nextCheckAt!) - Date.parse(first.checkedAt), 120_000);
  assertEquals(delivered.error, null);
});

Deno.test("follow stays away as long as bpost's Retry-After asks", async () => {
  const { ctx, store } = fakeContext();
  const { deps, sleeps } = fakeWorld([[OUT, NO_ROUND], "busy", "fail", [DELIVERED]]);
  await follow(ctx, deps, 120);
  assertEquals(sleeps, [60, 300, RETRY_SECONDS]);

  const busy = (store.get("status") as Status[])[1];
  assertEquals(busy.error, "bpost answered HTTP 429 for /track/items");
  assertEquals(Date.parse(busy.nextCheckAt!) - Date.parse(busy.checkedAt), 60_000 + 300_000);
});

Deno.test("requests name the client and its version, and nothing about the user", () => {
  const headers = requestHeaders();
  assertEquals(
    headers["user-agent"],
    `parcel-tracker/${model.version} (+${REPOSITORY_URL})`,
  );
  assert(!headers["user-agent"].includes("@"));
  assertEquals(headers["accept"], "application/json");
});

Deno.test("follow stops at an unknown parcel", async () => {
  const { deps } = fakeWorld([[{ items: [] }]]);
  await assertRejects(() => follow(fakeContext().ctx, deps, 120), ParcelNotFound);
});

Deno.test("a follow that ends on an error leaves a status that says so", async () => {
  const { ctx, store } = fakeContext();
  const { deps } = fakeWorld([[IN_TRANSIT], [{ items: [] }]]);
  await assertRejects(() => follow(ctx, deps, 120), ParcelNotFound);

  const final = store.get("status")!.at(-1) as Status;
  assert(final.error, "the status carries the error");
  assertEquals(final.following, false);
  assertEquals(final.nextCheckAt, null);
});

Deno.test("follow stops at the deadline", async () => {
  const { ctx, store } = fakeContext();
  const { deps, sleeps } = fakeWorld([[IN_TRANSIT]]);
  await follow(ctx, deps, 1);
  assertEquals(sleeps, [900, 900, 900, 900]);
  assertEquals((store.get("status")!.at(-1) as Status).following, false);
});

Deno.test("historyDurations reads other rounds of the same name only", async () => {
  const at = (m: number) => new Date(Date.parse("2026-11-05T10:00:00Z") + m * 60_000).toISOString();
  const sample = (m: number, s: number) => ({
    at: at(m),
    stops: s,
    progress: null,
    distanceKm: null,
  });
  const yesterday: Round = {
    roundName: "Res-318",
    day: "2026-11-05",
    samples: [sample(0, 9), sample(1, 8), sample(4, 7), sample(6, 6)],
  };
  const elsewhere: Round = { ...yesterday, roundName: "Res-999" };
  const { ctx } = fakeContext([
    { modelId: "other", name: "round-2026-11-05", attributes: yesterday },
    { modelId: "other2", name: "round-2026-11-05", attributes: elsewhere },
  ]);
  assertEquals(await historyDurations(ctx, "Res-318", "round-2026-11-06"), [180, 120]);
  assertEquals(await historyDurations(ctx, 'Res" || true', "x"), []);
  assertEquals(await historyDurations(ctx, null, "x"), []);
});
