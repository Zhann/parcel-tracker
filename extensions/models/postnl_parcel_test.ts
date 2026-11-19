import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.13";
import {
  BEHAVIOR_TYPE,
  checkOnce,
  type Deps,
  follow,
  MAX_FAILURES,
  type MethodContext,
  model,
  REPOSITORY_URL,
  requestHeaders,
  RETRY_SECONDS,
  type Status,
} from "./postnl_parcel.ts";
import { ParcelNotFound } from "./_lib/postnl.ts";

const CODE = "3SABCD123456789";
const fixture = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/postnl_received.json", import.meta.url)),
);

function step(index: number, message: string) {
  const body = structuredClone(fixture);
  body.colli[CODE].statusPhase = { index, message, route: null };
  return body;
}

const RECEIVED = fixture;
const OUT = step(3, "The driver is on the way");
const DELIVERED = step(4, "Shipment delivered");
const UNKNOWN = { colli: {}, processed: "2026-11-19T06:13:45+01:00" };

/** One scripted answer per look; "fail" is a bare 502, "busy" a 429 asking for 15 minutes. */
type Look = unknown | "fail" | "busy";

function fakeWorld(script: Look[], start = "2026-11-19T07:00:00Z") {
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
          new Response("slow down", { status: 429, headers: { "retry-after": "900" } }),
        );
      }
      return Promise.resolve(Response.json(look));
    },
  };
  return { deps, sleeps, urls };
}

function fakeContext(args: Partial<MethodContext["globalArgs"]> = {}) {
  const store = new Map<string, Record<string, unknown>[]>();
  const logs: string[] = [];
  const ctx: MethodContext = {
    globalArgs: {
      itemCode: CODE,
      postalCode: "1000",
      country: "",
      label: "Tickets",
      language: "EN",
      ...args,
    },
    logger: {
      info: (m, p) => logs.push(`info ${m} ${JSON.stringify(p)}`),
      warn: (m, p) => logs.push(`warn ${m} ${JSON.stringify(p)}`),
    },
    writeResource: (_spec, name, data) => {
      store.set(name, [...(store.get(name) ?? []), structuredClone(data)]);
      return Promise.resolve({ name });
    },
    readResource: (name) => Promise.resolve(store.get(name)?.at(-1) ?? null),
  };
  const statuses = () => (store.get("status") ?? []) as Status[];
  return { ctx, statuses, logs };
}

Deno.test("the model's literal type is the one its data is queried by", () => {
  assertEquals(model.type, BEHAVIOR_TYPE);
});

Deno.test("a look asks for the country the postal code gives, and writes a PostNL status", async () => {
  const { ctx, statuses } = fakeContext();
  const { deps, urls } = fakeWorld([RECEIVED]);
  const { status } = await checkOnce(ctx, deps, { following: false });
  assert(urls[0].endsWith(`/${CODE}-BE-1000?language=en`), urls[0]);
  assertEquals(status.carrier, "postnl");
  assertEquals(status.label, "Tickets");
  assertEquals(status.phase, "in_transit");
  assertEquals(status.window, { day: "2026-11-19", from: "", to: "" });
  assertEquals(status.following, false);
  assertEquals(status.nextCheckAt, null);
  assertEquals(status.round, null);
  assertEquals(status.eta, null);
  assertEquals(statuses().length, 1);
});

Deno.test("a given country wins over the postal code's shape", async () => {
  const { ctx } = fakeContext({ postalCode: "10115", country: "DE" });
  const { deps, urls } = fakeWorld([RECEIVED]);
  await checkOnce(ctx, deps, { following: false });
  assert(urls[0].includes(`/${CODE}-DE-10115?`), urls[0]);
});

Deno.test("a postal code that does not say its country fails without asking PostNL", async () => {
  const { ctx } = fakeContext({ postalCode: "10115" });
  const { deps, urls } = fakeWorld([RECEIVED]);
  await assertRejects(() => follow(ctx, deps, 24), Error, "country");
  assertEquals(urls, []);
});

Deno.test("follow paces by phase and ends at delivery", async () => {
  const { ctx, statuses } = fakeContext();
  const { deps, sleeps } = fakeWorld([RECEIVED, RECEIVED, OUT, OUT, DELIVERED]);
  await follow(ctx, deps, 24);
  assertEquals(sleeps, [1800, 1800, 600, 600]);
  const last = statuses().at(-1)!;
  assertEquals(last.phase, "done");
  assertEquals(last.following, false);
  assertEquals(last.nextCheckAt, null);
  assertEquals(statuses().find((s) => s.phase === "out_for_delivery")?.following, true);
});

Deno.test("follow keeps the archived flag it finds", async () => {
  const { ctx, statuses } = fakeContext();
  await ctx.writeResource("status", "status", { archived: true });
  await follow(ctx, fakeWorld([DELIVERED]).deps, 24);
  assertEquals(statuses().at(-1)!.archived, true);
});

Deno.test("follow retries failures five minutes apart, shows the error, then gives up", async () => {
  const { ctx, statuses } = fakeContext();
  const { deps, sleeps } = fakeWorld([RECEIVED, "fail"]);
  await assertRejects(() => follow(ctx, deps, 24 * 30));
  assertEquals(sleeps, [1800, ...Array(MAX_FAILURES - 1).fill(RETRY_SECONDS)]);
  assertEquals(RETRY_SECONDS, 300);
  const last = statuses().at(-1)!;
  assertEquals(last.error, "PostNL answered HTTP 502");
  assertEquals(last.following, false);
});

Deno.test("the next good look clears the error", async () => {
  const { ctx, statuses } = fakeContext();
  await follow(ctx, fakeWorld([RECEIVED, "fail", DELIVERED]).deps, 24);
  assertEquals(statuses().some((s) => s.error), true);
  assertEquals(statuses().at(-1)!.error, null);
});

Deno.test("follow stays away as long as PostNL's Retry-After asks", async () => {
  const { ctx } = fakeContext();
  const { deps, sleeps } = fakeWorld(["busy", DELIVERED]);
  await follow(ctx, deps, 24);
  assertEquals(sleeps, [900]);
});

Deno.test("follow stops at a parcel PostNL does not know", async () => {
  const { ctx } = fakeContext();
  await assertRejects(() => follow(ctx, fakeWorld([UNKNOWN]).deps, 24), ParcelNotFound);
});

Deno.test("follow stops at the deadline", async () => {
  const { ctx, statuses } = fakeContext();
  const { deps, sleeps } = fakeWorld([RECEIVED]);
  await follow(ctx, deps, 2);
  assertEquals(sleeps, [1800, 1800, 1800, 1800]); // the look at 2:00 is not past it
  assertEquals(statuses().at(-1)!.following, false);
});

Deno.test("requests name the client and its version, and nothing about the user", () => {
  const h = requestHeaders();
  assertEquals(h["user-agent"], `parcel-tracker/${model.version} (+${REPOSITORY_URL})`);
  assertEquals(Object.keys(h).sort(), ["accept", "user-agent"]);
});
