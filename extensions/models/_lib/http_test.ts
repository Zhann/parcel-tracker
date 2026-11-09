import { assertEquals } from "jsr:@std/assert@1.0.13";
import { parseRetryAfter } from "./http.ts";

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
