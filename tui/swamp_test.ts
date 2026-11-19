import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.13";
import { carrierFor, followArgs } from "./swamp.ts";

Deno.test("carrierFor tells DHL numbers from bpost codes", () => {
  assertEquals(carrierFor("1234567890"), "dhl");
  assertEquals(carrierFor("JJD000390005893028175"), "dhl");
  assertEquals(carrierFor("JVGL06048524783718330083"), "dhl");
  assertEquals(carrierFor("323299990000000000000001"), "bpost");
  assertEquals(carrierFor("CD123456785BE"), "bpost");
});

Deno.test("carrierFor tells PostNL's 3S barcodes from the rest", () => {
  assertEquals(carrierFor("3SMLFL649422187"), "postnl");
  assertEquals(carrierFor(" 3sabcd123456789 "), "postnl");
  assertEquals(carrierFor("3S12"), "bpost");
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

Deno.test("followArgs gives PostNL the postal code, and a country only when given", () => {
  const postnl = { carrier: "postnl" as const, code: "3SABCD123456789", label: "Tickets" };
  assertEquals(followArgs("/repo", { ...postnl, postcode: "9050" }), [
    "workflow",
    "run",
    "@zhann/follow-postnl-parcel",
    "--repo-dir",
    "/repo",
    "--input",
    "code=3SABCD123456789",
    "--input",
    "label=Tickets",
    "--input",
    "postcode=9050",
  ]);
  assertEquals(
    followArgs("/repo", { ...postnl, postcode: "10115", country: "DE" }).slice(-2),
    ["--input", "country=DE"],
  );
});

Deno.test("followArgs refuses a PostNL postal code whose country it cannot tell", () => {
  assertThrows(
    () => followArgs("/r", { carrier: "postnl", code: "3SABCD123456789", postcode: "", label: "" }),
    Error,
    "postal code",
  );
  assertThrows(
    () =>
      followArgs("/r", {
        carrier: "postnl",
        code: "3SABCD123456789",
        postcode: "10115",
        label: "",
      }),
    Error,
    "country",
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

Deno.test("followArgs passes a PostNL barcode in upper case, as PostNL's status holds it", () => {
  const args = followArgs("/r", {
    carrier: "postnl",
    code: " 3sabcd123456789 ",
    postcode: "9050",
    label: "",
  });
  assertEquals(args[6], "code=3SABCD123456789");
});
