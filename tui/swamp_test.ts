import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.13";
import { carrierFor, followArgs } from "./swamp.ts";

Deno.test("carrierFor tells DHL numbers from bpost codes", () => {
  assertEquals(carrierFor("1234567890"), "dhl");
  assertEquals(carrierFor("JJD000390005893028175"), "dhl");
  assertEquals(carrierFor("JVGL06048524783718330083"), "dhl");
  assertEquals(carrierFor("323299990000000000000001"), "bpost");
  assertEquals(carrierFor("CD123456785BE"), "bpost");
});

Deno.test("followArgs starts the carrier's own workflow", () => {
  assertEquals(
    followArgs("/repo", { code: "323299990000000000000001", postcode: "9050", label: "Desk" }),
    [
      "workflow",
      "run",
      "@zhann/follow-parcel",
      "--repo-dir",
      "/repo",
      "--input",
      "code=323299990000000000000001",
      "--input",
      "label=Desk",
      "--input",
      "postcode=9050",
    ],
  );
  assertEquals(
    followArgs("/repo", { carrier: "dhl", code: "1234567890", postcode: "", label: "Lamp" }),
    [
      "workflow",
      "run",
      "@zhann/follow-dhl-parcel",
      "--repo-dir",
      "/repo",
      "--input",
      "code=1234567890",
      "--input",
      "label=Lamp",
    ],
  );
});

Deno.test("followArgs refuses what a carrier cannot track", () => {
  assertThrows(() => followArgs("/r", { code: "1234567890", postcode: "", label: "" }), Error);
  assertThrows(
    () => followArgs("/r", { carrier: "dhl", code: "no spaces!", postcode: "", label: "" }),
    Error,
    "DHL",
  );
});
