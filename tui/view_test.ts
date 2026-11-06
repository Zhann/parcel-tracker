import { assert, assertEquals } from "jsr:@std/assert@1.0.13";
import type { Round, Status } from "../extensions/models/bpost_parcel.ts";
import {
  displayWidth,
  duration,
  fitLine,
  plain,
  render,
  sparkline,
  stateCell,
  truncate,
  type ViewState,
} from "./view.ts";

const NOW = new Date("2026-11-06T10:30:00Z"); // 11:30 in Brussels

function status(over: Partial<Status> = {}): Status {
  return {
    itemCode: "323299990000000000000001",
    label: "Coolblue",
    product: "bpack 24h pro",
    sender: "Coolblue",
    weightGrams: 17700,
    phase: "out_for_delivery",
    step: {
      name: "out_for_delivery",
      knownProcessStep: "ON_THE_WAY_TO_YOU",
      text: "On the way to you",
    },
    window: { day: "2026-11-06", from: "08:00", to: "14:00" },
    roundName: "Res-318",
    events: [{
      at: "2026-11-06T09:32",
      location: "LEDEBERG MAIL",
      text: "Shipment being prepared by the postman",
    }],
    round: { at: "2026-11-06T10:29:40Z", stops: 12, progress: 0.41, distanceKm: 1.8 },
    eta: {
      stops: 12,
      anchor: "2026-11-06T10:28:00Z",
      pace: { p25: 115, p50: 160, p75: 210 },
      basis: "live",
      intervals: 14,
      earliest: "2026-11-06T10:51:00Z",
      likely: "2026-11-06T11:00:00Z",
      latest: "2026-11-06T11:10:00Z",
    },
    archived: false,
    following: true,
    checkedAt: "2026-11-06T10:29:40Z",
    nextCheckAt: "2026-11-06T10:30:10Z",
    error: null,
    ...over,
  };
}

const round: Round = {
  roundName: "Res-318",
  day: "2026-11-06",
  samples: [20, 19, 17, 15, 12].map((stops, i) => ({
    at: new Date(Date.parse("2026-11-06T10:00:00Z") + i * 400_000).toISOString(),
    stops,
    progress: null,
    distanceKm: 1.8,
  })),
};

function view(over: Partial<ViewState> = {}): ViewState {
  return {
    rows: [{ name: "bpost-1", status: status() }, {
      name: "bpost-2",
      status: status({ label: "Books", phase: "in_transit", round: null, eta: null }),
    }],
    selected: 0,
    showArchived: false,
    round,
    footer: null,
    loading: false,
    lastError: null,
    ...over,
  };
}

// deno-lint-ignore no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

Deno.test("displayWidth counts wide glyphs as two", () => {
  assertEquals(displayWidth("✅ delivered"), 12);
  assertEquals(displayWidth("⚠️ stale"), 8);
  assertEquals(displayWidth("● 12 stops"), 10);
});

Deno.test("truncate and fitLine keep exact widths", () => {
  assertEquals(truncate("abcdefgh", 5), "abcd…");
  assertEquals(displayWidth(plain(fitLine([["✅ delivered"], [" more text"]], 8))), 8);
  assertEquals(displayWidth(plain(fitLine([["ab"]], 6))), 6);
});

Deno.test("duration reads like a clock", () => {
  assertEquals(duration(45), "45s");
  assertEquals(duration(160), "2m40");
  assertEquals(duration(3900), "1h05");
});

Deno.test("sparkline falls with the stops and fits its width", () => {
  assertEquals(sparkline([8, 4, 0], 10), "█▅▁");
  assertEquals(sparkline(Array(100).fill(5), 20).length, 20);
});

Deno.test("state cells carry a glyph and a word, never colour alone", () => {
  assertEquals(stateCell(status(), NOW)[0], "● 12 stops");
  assertEquals(stateCell(status({ phase: "done", round: null }), NOW)[0], "✅ delivered");
  assertEquals(stateCell(status({ error: "bpost answered HTTP 502" }), NOW)[0], "❌ error");
  const stale = status({ nextCheckAt: "2026-11-06T10:00:00Z" });
  assertEquals(stateCell(stale, NOW)[0], "⚠️ stale");
});

Deno.test("render fills the screen exactly, wide and narrow", () => {
  for (const [w, h] of [[120, 30], [60, 40]]) {
    const lines = render(view(), NOW, w, h).map(strip);
    assertEquals(lines.length, h);
    for (const l of lines) assertEquals(displayWidth(l), w, JSON.stringify(l));
  }
});

Deno.test("render shows the live round in Brussels time", () => {
  const screen = render(view(), NOW, 120, 30).map(strip).join("\n");
  assert(screen.includes("11:30"), "clock in Brussels time");
  assert(screen.includes("12 left"));
  assert(!screen.includes("41%"), "bpost's progress is not a percentage");
  assert(screen.includes("2m40 a stop"));
  assert(screen.includes("11:51–12:10"), screen);
  assert(screen.includes("likely 12:00 · in 30 min"));
  assert(screen.includes("1.8 km away"));
  assert(screen.includes("06/11 09:32"));
  assert(screen.includes("following · next in 10s"));
});

Deno.test("archived parcels hide until asked for", () => {
  const rows = [{ name: "a", status: status({ label: "Old", archived: true }) }];
  const hidden = render(view({ rows }), NOW, 100, 10).map(strip).join("\n");
  assert(hidden.includes("No parcels yet"));
  const shown = render(view({ rows, showArchived: true }), NOW, 100, 10).map(strip).join("\n");
  assert(shown.includes("Old"));
});
