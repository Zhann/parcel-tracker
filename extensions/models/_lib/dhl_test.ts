import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.13";
import {
  HttpError,
  localStamp,
  nextCheckSeconds,
  ParcelNotFound,
  parseShipments,
  phaseOf,
  scrubText,
  townOf,
  trackShipment,
  trackUrl,
  windowOf,
} from "./dhl.ts";

/** A synthetic Express answer shaped like DHL's, with made-up people and streets. */
const outForDelivery = JSON.parse(
  await Deno.readTextFile(
    new URL("../fixtures/dhl_express_out_for_delivery.json", import.meta.url),
  ),
);

Deno.test("parseShipments reads an Express shipment out for delivery", () => {
  const s = parseShipments(outForDelivery, "7777777770");
  assertEquals(s.itemCode, "7777777770");
  assertEquals(s.service, "express");
  assertEquals(s.phase, "out_for_delivery");
  assertEquals(s.step, {
    name: "transit",
    knownProcessStep: null,
    text: "Shipment is out with courier for delivery",
  });
  assertEquals(s.product, "EXPRESS WORLDWIDE");
  assertEquals(s.sender, "Example Shop BV");
  assertEquals(s.weightGrams, 1200);
  assertEquals(s.window, { day: "2026-11-06", from: "09:00", to: "18:00" });
  assertEquals(s.events.length, 4);
  assertEquals(s.events[0], {
    at: "2026-11-06T08:41",
    location: "GHENT - BELGIUM",
    text: "Shipment is out with courier for delivery",
  });
  // No zone: the event's own local time, kept as it is.
  assertEquals(s.events[3].at, "2026-11-05T15:02");
});

Deno.test("nothing about the receiver, nor any street, survives the parse", () => {
  const kept = JSON.stringify(parseShipments(outForDelivery, "7777777770"));
  for (const leak of ["Rita", "Receiver", "Sam Sender", "Teststraat", "Voorbeeldstraat", "9000"]) {
    assert(!kept.includes(leak), `${leak} was kept`);
  }
  assert(kept.includes("AMSTERDAM"), "the town of a location is kept");
});

Deno.test("phaseOf reads DHL's code and its English texts", () => {
  assertEquals(phaseOf("pre-transit", "Shipment information received"), "in_transit");
  assertEquals(phaseOf("transit", "Arrived at DHL Delivery Facility"), "in_transit");
  assertEquals(phaseOf("transit", "Shipment is out with courier for delivery"), "out_for_delivery");
  assertEquals(
    phaseOf("transit", "The shipment has been loaded onto the delivery vehicle"),
    "out_for_delivery",
  );
  assertEquals(
    phaseOf("transit", "The shipment is ready for pick-up at the PACKSTATION"),
    "at_pickup_point",
  );
  assertEquals(
    phaseOf("delivered", "The shipment has been delivered to the selected retail outlet"),
    "at_pickup_point",
  );
  assertEquals(phaseOf("delivered", "Delivered"), "done");
  assertEquals(phaseOf("delivered", "Returned to shipper"), "done");
  assertEquals(phaseOf("failure", "Shipment is being returned to the sender"), "returning");
  assertEquals(phaseOf("failure", "Delivery attempted; recipient not home"), "in_transit");
  assertEquals(phaseOf(null, ""), "in_transit");
});

Deno.test("scrubText cuts the name of whoever signed", () => {
  assertEquals(scrubText("Delivered - Signed for by: RITA RECEIVER"), "Delivered");
  assertEquals(scrubText("Delivered, signed for by Rita"), "Delivered");
  assertEquals(scrubText("Shipment picked up"), "Shipment picked up");
});

Deno.test("townOf keeps the last part of a locality only", () => {
  assertEquals(townOf({ address: { addressLocality: "Oderweg 2, AMSTERDAM" } }), "AMSTERDAM");
  assertEquals(
    townOf({ address: { addressLocality: "BRUSSELS - BELGIUM" } }),
    "BRUSSELS - BELGIUM",
  );
  assertEquals(
    townOf({ address: { addressLocality: "HOOFDDORP - NETHERLANDS, THE" } }),
    "HOOFDDORP - NETHERLANDS",
  );
  assertEquals(townOf({ address: {} }), null);
  assertEquals(townOf(undefined), null);
});

Deno.test("localStamp turns zoned times into Brussels time", () => {
  assertEquals(localStamp("2026-11-06T07:41:00Z"), {
    day: "2026-11-06",
    time: "08:41",
    date: "2026-11-06",
    midnight: false,
  });
  assertEquals(localStamp("2026-11-06T23:30:00Z")?.day, "2026-11-07");
  assertEquals(localStamp("2026-11-06T15:02:00")?.time, "15:02");
  assertEquals(localStamp("2026-11-06T00:00:00Z")?.midnight, true);
  assertEquals(localStamp("next tuesday"), null);
  assertEquals(localStamp(null), null);
});

Deno.test("windowOf prefers DHL's time frame, then its ETA", () => {
  assertEquals(
    windowOf({
      estimatedDeliveryTimeFrame: {
        estimatedFrom: "2026-11-06T00:00:00Z",
        estimatedThrough: "2026-11-06T21:00:00Z",
      },
    }),
    { day: "2026-11-06", from: "", to: "22:00" },
  );
  assertEquals(
    windowOf({ estimatedTimeOfDelivery: "2026-11-06T12:00:00+01:00" }),
    { day: "2026-11-06", from: "12:00", to: "12:00" },
  );
  assertEquals(
    windowOf({ estimatedTimeOfDelivery: "2026-11-06T00:00:00Z" }),
    { day: "2026-11-06", from: "", to: "" },
  );
  assertEquals(windowOf({}), null);
});

Deno.test("parseShipments throws ParcelNotFound on no shipment", () => {
  assertThrows(() => parseShipments({ shipments: [] }, "x"), ParcelNotFound);
});

Deno.test("trackUrl sends what was given, and the language in lower case", () => {
  const url = new URL(trackUrl("7777777770", { service: "express", language: "NL" }));
  assertEquals(url.origin + url.pathname, "https://api-eu.dhl.com/track/shipments");
  assertEquals(url.searchParams.get("trackingNumber"), "7777777770");
  assertEquals(url.searchParams.get("service"), "express");
  assertEquals(url.searchParams.get("language"), "nl");
  assertEquals(url.searchParams.has("recipientPostalCode"), false);
});

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  Promise.resolve(Response.json(body, { status, headers }));

Deno.test("trackShipment reads a 404 as an unknown shipment", async () => {
  await assertRejects(
    () =>
      trackShipment(
        "1234567890",
        {},
        answer(404, { status: 404, title: "No result found", detail: "No shipment found." }),
      ),
    ParcelNotFound,
  );
});

Deno.test("a rejected key is fatal, a 429 is not and says how long to wait", async () => {
  const rejected = await assertRejects(
    () => trackShipment("1234567890", {}, answer(401, { status: 401, title: "Unauthorized" })),
    HttpError,
  );
  assertEquals(rejected.fatal, true);
  assertEquals(rejected.message, "DHL answered HTTP 401; check the DHL API key in the vault");

  const busy = await assertRejects(
    () =>
      trackShipment(
        "1234567890",
        {},
        answer(429, { status: 429, detail: "Too many requests" }, { "retry-after": "120" }),
      ),
    HttpError,
  );
  assertEquals(busy.fatal, false);
  assertEquals(busy.retryAfterSeconds, 120);
  assertEquals(busy.message, "DHL answered HTTP 429: Too many requests");
});

Deno.test("nextCheckSeconds keeps a day under a new key's 250 calls", () => {
  assertEquals(nextCheckSeconds("done"), null);
  assertEquals(nextCheckSeconds("out_for_delivery"), 900);
  assertEquals(nextCheckSeconds("in_transit"), 1800);
  assertEquals(nextCheckSeconds("at_pickup_point"), 4 * 3600);
  assert(86_400 / nextCheckSeconds("out_for_delivery")! < 100);
});
