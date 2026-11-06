import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.13";
import type { Status } from "../models/bpost_parcel.ts";
import { EVENTS_SHOWN, type ParcelReportContext, report, summarize } from "./parcel_report.ts";

const NOW = new Date("2026-11-06T10:00:00Z"); // 11:00 in Brussels

const OUT: Status = {
  itemCode: "323299990000000000000001",
  label: "Desk",
  product: "bpack 24h pro",
  sender: "Shop",
  weightGrams: 460,
  phase: "out_for_delivery",
  step: {
    name: "out_for_delivery_byCar",
    knownProcessStep: "ON_THE_WAY_TO_YOU",
    text: "On the way to you",
  },
  window: { day: "2026-11-06", from: "11:10", to: "14:15" },
  roundName: "Res-318",
  events: [
    { at: "2026-11-06T10:06", location: "LEDEBERG MAIL", text: "Item in distribution phase" },
    { at: "2026-11-06T09:32", location: "LEDEBERG MAIL", text: "Shipment being prepared" },
    { at: "2026-11-05T19:47", location: "PSM AX BEUMER", text: "Your item has been sorted" },
    { at: "2026-11-05T08:50", location: "LCI", text: "Preparation received" },
    { at: "2026-11-05T08:00", location: null, text: "Announced" },
  ],
  round: { at: "2026-11-06T09:59:30Z", stops: 12, progress: 0.41, distanceKm: 1.84 },
  eta: {
    stops: 12,
    anchor: "2026-11-06T09:58:00Z",
    pace: { p25: 115, p50: 160, p75: 210 },
    basis: "live",
    intervals: 14,
    earliest: "2026-11-06T10:21:00Z",
    likely: "2026-11-06T10:30:00Z",
    latest: "2026-11-06T10:40:00Z",
  },
  archived: false,
  following: true,
  checkedAt: "2026-11-06T09:59:30Z",
  nextCheckAt: "2026-11-06T10:00:00Z",
  error: null,
};

const DELIVERED: Status = {
  ...OUT,
  phase: "done",
  step: { name: "delivered", knownProcessStep: "DELIVERED_AT_HOME", text: "Delivered" },
  round: null,
  eta: null,
  following: false,
  nextCheckAt: null,
};

Deno.test("a live round reads as ETA, stops, van and pace in Brussels time", () => {
  const { markdown, json } = summarize(OUT, NOW);
  assertStringIncludes(markdown, "## Desk — out for delivery");
  assertStringIncludes(markdown, "On the way to you · bpack 24h pro · 0.5 kg");
  assertStringIncludes(markdown, "- **ETA** 11:30, in 30 min (11:21–11:40)");
  assertStringIncludes(markdown, "- **Stops** 12 left · round Res-318");
  assertStringIncludes(markdown, "- **Van** 1.8 km away");
  assertStringIncludes(markdown, "- **Pace** 2m40 a stop (p25 1m55 · p75 3m30) · live, 14 stops");
  assertStringIncludes(markdown, "- **bpost** today 11:10–14:15");
  assertStringIncludes(markdown, "- **Checked** 10:59 · following, next look 11:00");
  assertEquals(json.stopsLeft, 12);
  assertEquals((json.eta as { minutesFromNow: number }).minutesFromNow, 30);
});

Deno.test("the timeline shows the latest events only", () => {
  const { markdown } = summarize(OUT, NOW);
  assertStringIncludes(markdown, "- 06/11 10:06 · LEDEBERG MAIL · Item in distribution phase");
  assertEquals(markdown.split("\n").filter((l) => /^- \d\d\/\d\d /.test(l)).length, EVENTS_SHOWN);
  assert(!markdown.includes("Announced"));
});

Deno.test("a delivered parcel drops the round, the ETA and bpost's window", () => {
  const { markdown, json } = summarize(DELIVERED, NOW);
  assertStringIncludes(markdown, "## Desk — delivered");
  assertStringIncludes(markdown, "- **Checked** 10:59 · done");
  for (const gone of ["**ETA**", "**Stops**", "**Van**", "**Pace**", "**bpost**"]) {
    assert(!markdown.includes(gone), `${gone} is not shown`);
  }
  assertEquals(json.eta, null);
  assertEquals(json.stopsLeft, null);
});

Deno.test("a failed method's error is shown over an older status", () => {
  const { markdown, json } = summarize(OUT, NOW, "bpost answered HTTP 502 for /track/items");
  assertStringIncludes(markdown, "- **Error** bpost answered HTTP 502 for /track/items");
  assertEquals(json.error, "bpost answered HTTP 502 for /track/items");
});

function context(status: Status | null, executionStatus: "succeeded" | "failed" = "succeeded") {
  const asked: string[] = [];
  const ctx: ParcelReportContext = {
    modelType: "@zhann/bpost-parcel",
    modelId: "m1",
    executionStatus,
    errorMessage: executionStatus === "failed" ? "No bpost parcel 3232" : undefined,
    dataRepository: {
      getContent: (_type, modelId, dataName) => {
        asked.push(`${modelId}/${dataName}`);
        return Promise.resolve(
          status ? new TextEncoder().encode(JSON.stringify(status)) : null,
        );
      },
    },
  };
  return { ctx, asked };
}

Deno.test("the report reads the behavior's latest status", async () => {
  const { ctx, asked } = context(DELIVERED);
  const { markdown } = await report.execute(ctx);
  assertEquals(asked, ["m1/status"]);
  assertStringIncludes(markdown, "## Desk — delivered");
});

Deno.test("a parcel never looked at says why there is nothing to show", async () => {
  assertEquals((await report.execute(context(null).ctx)).json.status, null);
  const { markdown } = await report.execute(context(null, "failed").ctx);
  assertEquals(markdown, "No parcel status: No bpost parcel 3232.\n");
});
