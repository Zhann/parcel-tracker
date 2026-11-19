import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.13";
import {
  countryOf,
  HttpError,
  nextCheckSeconds,
  ParcelNotFound,
  parseColli,
  phaseOf,
  trackParcel,
  trackUrl,
  windowOf,
} from "./postnl.ts";

/**
 * A PostNL answer for a Belgian parcel just received, as the tracking page
 * gets it, with the receiver, the sender's people and every hash made up.
 */
const received = JSON.parse(
  await Deno.readTextFile(new URL("../fixtures/postnl_received.json", import.meta.url)),
);
const CODE = "3SABCD123456789";

Deno.test("parseColli reads a parcel PostNL has just received", () => {
  const p = parseColli(received, CODE);
  assertEquals(p.itemCode, CODE);
  assertEquals(p.phase, "in_transit");
  assertEquals(p.step, {
    name: "InTransit",
    knownProcessStep: "B01",
    text: "Shipment received by PostNL",
  });
  assertEquals(p.product, "Parcel");
  assertEquals(p.sender, "Example Shop BV");
  assertEquals(p.weightGrams, 240);
  // A whole-day estimate is a day, not 08:00–21:30.
  assertEquals(p.window, { day: "2026-11-19", from: "", to: "" });
  assertEquals(p.events.length, 5);
  assertEquals(p.events[0], {
    at: "2026-11-18T23:28",
    location: null,
    text: "Delivery cannot be changed",
  });
  assertEquals(p.events.at(-1), {
    at: "2026-11-18T20:31",
    location: null,
    text: "Shipment expected, but not yet arrived or processed at PostNL",
  });
});

Deno.test("nothing about the receiver, nor the sender's people, survives the parse", () => {
  const kept = JSON.stringify(parseColli(received, CODE));
  for (
    const leak of [
      "Rita",
      "Receiver",
      "Sam Sender",
      "Voorbeeldstraat",
      "Teststraat",
      "1000",
      "Hash",
    ]
  ) {
    assert(!kept.includes(leak), `${leak} was kept`);
  }
  assert(!/0{16}|1{16}/.test(kept), "a hash was kept");
});

/** The fixture moved on: PostNL's step, where it goes, and its status text. */
function at(index: number, message: string, addressType = "Recipient") {
  const body = structuredClone(received);
  const collo = body.colli[CODE];
  collo.statusPhase = { index, message, route: null };
  collo.deliveryAddressType = addressType;
  return body;
}

Deno.test("PostNL's steps 0 to 4 are in transit, out for delivery and delivered", () => {
  const phase = (b: unknown) => parseColli(b, CODE).phase;
  assertEquals(phase(at(0, "Shipment expected")), "in_transit");
  assertEquals(phase(at(2, "Shipment sorted")), "in_transit");
  assertEquals(phase(at(3, "The driver is on the way")), "out_for_delivery");
  assertEquals(phase(at(4, "Shipment delivered")), "done");
  assertEquals(phase(at(4, "Bezorgd bij de buren", "Neighbour")), "done");
});

Deno.test("a parcel for a pickup point waits there until it is picked up", () => {
  const phase = (b: unknown) => parseColli(b, CODE).phase;
  // On its way to the point is not on its way to the door.
  assertEquals(phase(at(3, "On its way to the PostNL point", "ServicePoint")), "in_transit");
  assertEquals(
    phase(at(4, "Ready for pickup at the PostNL point", "ServicePoint")),
    "at_pickup_point",
  );
  assertEquals(phase(at(4, "Shipment picked up", "ServicePoint")), "done");
  assertEquals(phase(at(4, "Het pakket is opgehaald", "Collect")), "done");
  assertEquals(phaseOf(4, "Rerouted", "Ready for pickup", true), "at_pickup_point");
  assertEquals(phaseOf(4, "Rerouted", "Delivered at the new address", false), "done");
});

Deno.test("a parcel going back is returning until it is back", () => {
  assertEquals(phaseOf(2, "Sender", "Shipment on its way back"), "returning");
  assertEquals(phaseOf(2, "Recipient", "Shipment is being returned to the sender"), "returning");
  assertEquals(phaseOf(3, "Recipient", "Zending gaat retour naar de afzender"), "returning");
  assertEquals(phaseOf(4, "Return", "Delivered back to the sender"), "done");
});

Deno.test("windowOf reads each of PostNL's estimate types", () => {
  const eta = (type: string, start: string | null, end: string | null) =>
    windowOf({ type, start, end, minutesOverdue: null });
  assertEquals(
    eta("Specific", "2026-11-19T13:15:00+01:00", "2026-11-19T15:15:00+01:00"),
    { day: "2026-11-19", from: "13:15", to: "15:15" },
  );
  assertEquals(
    eta("WholeDay", "2026-11-19T08:00:00+01:00", "2026-11-19T21:30:00+01:00"),
    { day: "2026-11-19", from: "", to: "" },
  );
  assertEquals(
    eta("OnlyFromTime", "2026-11-19T17:00:00+01:00", null),
    { day: "2026-11-19", from: "17:00", to: "" },
  );
  assertEquals(
    eta("MultipleDaySpan", "2026-11-19T08:00:00+01:00", "2026-11-21T21:30:00+01:00"),
    { day: "2026-11-21", from: "", to: "" },
  );
  assertEquals(eta("Unknown", null, null), null);
  assertEquals(windowOf(null), null);
});

Deno.test("countryOf tells Belgian, Dutch and Luxembourg postal codes apart", () => {
  assertEquals(countryOf("9050"), "BE");
  assertEquals(countryOf("1000"), "BE");
  assertEquals(countryOf("2511 AB"), "NL");
  assertEquals(countryOf("2511ab"), "NL");
  assertEquals(countryOf("L-1234"), "LU");
  // Five digits could be German, French, Italian, …: the country must be given.
  assertEquals(countryOf("10115"), null);
  assertEquals(countryOf("0123"), null);
});

Deno.test("trackUrl puts code, country and postal code in the key PostNL's page uses", () => {
  assertEquals(
    trackUrl("3sabcd123456789", "9050", "BE"),
    "https://tracking.postnl.nl/track-and-trace/api/trackAndTrace/3SABCD123456789-BE-9050?language=en",
  );
  assertEquals(
    trackUrl("3SABCD123456789", "2511 ab", "nl", "NL"),
    "https://tracking.postnl.nl/track-and-trace/api/trackAndTrace/3SABCD123456789-NL-2511AB?language=nl",
  );
  assert(trackUrl("3SABCD123456789", "L-1234", "LU").includes("-LU-1234?"));
});

Deno.test("no collo for the code is an unknown parcel", () => {
  assertThrows(
    () => parseColli({ colli: {}, processed: "2026-11-19T06:13:45+01:00" }, CODE),
    ParcelNotFound,
  );
});

Deno.test("trackParcel reads PostNL's answer, and a 429 says how long to wait", async () => {
  const ok = await trackParcel(
    CODE,
    "1000",
    "BE",
    "EN",
    () => Promise.resolve(Response.json(received)),
  );
  assertEquals(ok.sender, "Example Shop BV");

  const err = await assertRejects(
    () =>
      trackParcel(
        CODE,
        "1000",
        "BE",
        "EN",
        () =>
          Promise.resolve(
            new Response("slow down", { status: 429, headers: { "retry-after": "120" } }),
          ),
      ),
    HttpError,
  );
  assertEquals(err.status, 429);
  assertEquals(err.retryAfterSeconds, 120);
});

Deno.test("nextCheckSeconds looks every 10 minutes on the day, and stops when done", () => {
  assertEquals(nextCheckSeconds("in_transit"), 1800);
  assertEquals(nextCheckSeconds("out_for_delivery"), 600);
  assertEquals(nextCheckSeconds("at_pickup_point"), 3600);
  assertEquals(nextCheckSeconds("returning"), 1800);
  assertEquals(nextCheckSeconds("done"), null);
});

Deno.test("ready to be collected is not picked up", () => {
  for (
    const text of [
      "Your parcel is ready to be collected",
      "The parcel can be collected at the PostNL point",
      "Je pakket ligt klaar en kan worden opgehaald",
      "Available for pickup",
    ]
  ) {
    assertEquals(phaseOf(4, "ServicePoint", text), "at_pickup_point", text);
  }
  assertEquals(phaseOf(4, "ServicePoint", "Your parcel has been collected"), "done");
  assertEquals(phaseOf(4, "ServicePoint", "Pakket is opgehaald"), "done");
});

Deno.test("an unknown parcel names the country it was asked for", () => {
  const err = assertThrows(() => parseColli({ colli: {} }, CODE, "BE"), ParcelNotFound);
  assert(err.message.includes("in BE"), err.message);
  assert(err.message.includes("country="), err.message);
});
