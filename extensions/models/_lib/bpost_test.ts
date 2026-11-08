import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.13";
import {
  haversineKm,
  HttpError,
  nextCheckSeconds,
  ParcelNotFound,
  parseItems,
  parseRetryAfter,
  parseRound,
  phaseOf,
  trackParcel,
} from "./bpost.ts";

const outForDelivery = JSON.parse(
  await Deno.readTextFile(
    new URL("../fixtures/items_out_for_delivery.json", import.meta.url),
  ),
);

Deno.test("parseItems reads an out-for-delivery parcel", () => {
  const p = parseItems(outForDelivery, "323299990000000000000001");
  assertEquals(p.phase, "out_for_delivery");
  assertEquals(p.step.knownProcessStep, "ON_THE_WAY_TO_YOU");
  assertEquals(p.step.text, "Shipment being prepared by the postman");
  assertEquals(p.window, { day: "2026-11-06", from: "08:00", to: "14:00" });
  assertEquals(p.roundName, "Res-318");
  assertEquals(p.sender, "Coolblue");
  assertEquals(p.weightGrams, 17700);
  assertEquals(p.events[0], {
    at: "2026-11-06T09:32",
    location: "LEDEBERG MAIL",
    text: "Shipment being prepared by the postman",
  });
});

Deno.test("parseItems speaks the asked language", () => {
  const p = parseItems(outForDelivery, "x", "NL");
  assertEquals(p.step.text, "Zending wordt voorbereid door de postbode");
  assertEquals(p.events[1].text, "De zending werd gesorteerd");
});

Deno.test("parseItems keeps nothing about the receiver", () => {
  const kept = JSON.stringify(parseItems(outForDelivery, "x"));
  for (const sentinel of ["SENTINEL", "receiver", "linkTo"]) {
    assert(!kept.includes(sentinel), `${sentinel} leaked into ${kept}`);
  }
});

Deno.test("parseItems throws ParcelNotFound on an empty answer", () => {
  assertThrows(() => parseItems({ items: [] }, "abc"), ParcelNotFound);
});

Deno.test("phaseOf maps bpost's steps", () => {
  assertEquals(phaseOf("IN_PREPARATION", "prepare", "active"), "in_transit");
  assertEquals(phaseOf("PROCESSING", "processing", "active"), "in_transit");
  assertEquals(phaseOf("ON_THE_WAY_TO_YOU", "out_for_delivery", "active"), "out_for_delivery");
  assertEquals(phaseOf("ON_THE_WAY_TO_POST_POINT", null, null), "out_for_delivery");
  assertEquals(phaseOf("AVAILABLE_IN_POST_POINT", null, null), "at_pickup_point");
  assertEquals(phaseOf("ON_THE_WAY_TO_SENDER", null, null), "returning");
  assertEquals(phaseOf("DELIVERED_AT_HOME", "delivered", "active"), "done");
  assertEquals(phaseOf("DELIVERED_AT_NEIGHBOUR", null, null), "done");
  assertEquals(phaseOf("PICKED_UP_IN_POST_POINT", null, null), "done");
  assertEquals(phaseOf(null, "delivered", "completed"), "done");
  assertEquals(phaseOf(null, "delivered", "upcoming"), "in_transit");
});

Deno.test("parseRound is null before the round starts", () => {
  assertEquals(parseRound({ error: "No round status info can be rendered" }), null);
  assertEquals(parseRound({ itemOnRoundStatus: { nrOfStopsUntilTarget: [] } }), null);
});

Deno.test("parseRound reduces coordinates to a distance", () => {
  const r = parseRound({
    itemOnRoundStatus: {
      nrOfStopsUntilTarget: ["12"],
      progressUntilTarget: ["0.41"],
      lastKnownLocation: [{ lat: ["51.0300"], long: ["3.7300"] }],
      targetLocation: [{ lat: ["51.0400"], long: ["3.7300"] }],
    },
  });
  assertEquals(r, { stops: 12, progress: 0.41, distanceKm: 1.1 });
});

Deno.test("parseRound reads a percentage progress as a fraction", () => {
  const r = parseRound({
    itemOnRoundStatus: { nrOfStopsUntilTarget: [3], progressUntilTarget: [75] },
  });
  assertEquals(r, { stops: 3, progress: 0.75, distanceKm: null });
});

Deno.test("haversineKm: Gent to Brussels is about 50 km", () => {
  const d = haversineKm({ lat: 51.0543, lon: 3.7174 }, { lat: 50.8503, lon: 4.3517 });
  assert(d > 48 && d < 52, String(d));
});

Deno.test("nextCheckSeconds paces by phase", () => {
  assertEquals(nextCheckSeconds("out_for_delivery", true), 30);
  assertEquals(nextCheckSeconds("out_for_delivery", false), 60);
  assertEquals(nextCheckSeconds("in_transit", false), 900);
  assertEquals(nextCheckSeconds("at_pickup_point", false), 3600);
  assertEquals(nextCheckSeconds("done", false), null);
});

function fakeFetch(answers: Record<string, unknown>) {
  const asked: string[] = [];
  const fn = (url: string) => {
    asked.push(url);
    const path = new URL(url).pathname.split("/").pop()!;
    return Promise.resolve(Response.json(answers[path]));
  };
  return { fn, asked };
}

Deno.test("trackParcel asks for the round only when out for delivery", async () => {
  const { fn, asked } = fakeFetch({
    items: outForDelivery,
    itemonroundstatus: { itemOnRoundStatus: { nrOfStopsUntilTarget: ["4"] } },
  });
  const { parcel, round } = await trackParcel("323299990000000000000001", "9050", "EN", fn);
  assertEquals(parcel.phase, "out_for_delivery");
  assertEquals(round?.stops, 4);
  assertEquals(asked.length, 2);
  assert(asked[0].includes("postalCode=9050"));

  const inTransit = structuredClone(outForDelivery);
  inTransit.items[0].activeStep = {
    name: "processing",
    status: "active",
    knownProcessStep: "PROCESSING",
  };
  const second = fakeFetch({ items: inTransit });
  const r2 = await trackParcel("x", "9050", "EN", second.fn);
  assertEquals(r2.round, null);
  assertEquals(second.asked.length, 1);
});

Deno.test("trackParcel surfaces an HTTP error", async () => {
  const fn = () => Promise.resolve(new Response("nope", { status: 503 }));
  await assertRejects(() => trackParcel("x", "9050", "EN", fn), Error, "HTTP 503");
});

Deno.test("trackParcel passes on bpost's Retry-After", async () => {
  const fn = () =>
    Promise.resolve(new Response("busy", { status: 429, headers: { "retry-after": "120" } }));
  const err = await assertRejects(() => trackParcel("x", "9050", "EN", fn), HttpError);
  assertEquals(err.status, 429);
  assertEquals(err.retryAfterSeconds, 120);

  const plain = () => Promise.resolve(new Response("down", { status: 502 }));
  const err2 = await assertRejects(() => trackParcel("x", "9050", "EN", plain), HttpError);
  assertEquals(err2.retryAfterSeconds, null);
});

Deno.test("parseRetryAfter reads seconds and HTTP dates", () => {
  const now = new Date("2026-11-08T10:00:00Z");
  assertEquals(parseRetryAfter("90", now), 90);
  assertEquals(parseRetryAfter(" 0 ", now), 0);
  assertEquals(parseRetryAfter("Sun, 08 Nov 2026 10:02:00 GMT", now), 120);
  assertEquals(parseRetryAfter("Sun, 08 Nov 2026 09:00:00 GMT", now), 0);
  assertEquals(parseRetryAfter("soon", now), null);
  assertEquals(parseRetryAfter("-5", now), null);
  assertEquals(parseRetryAfter(null, now), null);
});
