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
  REPOSITORY_URL,
  requestHeaders,
  RETRY_SECONDS,
  type Status,
} from "./dhl_parcel.ts";
import { HttpError, ParcelNotFound } from "./_lib/dhl.ts";

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

function fakeContext() {
  const store = new Map<string, Record<string, unknown>[]>();
  const logs: string[] = [];
  const ctx: MethodContext = {
    globalArgs: {
      trackingNumber: "7777777770",
      apiKey: "test-key",
      service: "express",
      postalCode: "",
      label: "Lamp",
      language: "EN",
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
  return { ctx, store, logs };
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
