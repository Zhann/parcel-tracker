# PostNL terms vs. the parcel tracker

Does following a PostNL parcel through the endpoint PostNL's tracking page
uses break PostNL's terms, and does publishing `@zhann/postnl-parcel`?

All pages were fetched on **2026-11-19**. PostNL says it may change its terms
"zonder voorafgaande aankondiging", so re-check before relying on this.

> **Not legal advice.** This compares the project with the text PostNL
> publishes. It is not a lawyer's opinion. For anything past personal use, ask
> a lawyer or PostNL.

## Verdict

- **Personal use is explicitly allowed.** PostNL's data terms say: "U mag de
  data slechts gebruiken voor persoonlijk gebruik c.q. voor strikt intern
  gebruik binnen uw onderneming." That is a firmer footing than bpost's terms,
  which allow nothing explicitly.
- **Passing the data on is forbidden**: "Het is niet toegestaan de data te
  verhandelen, te reproduceren of anderszins ter beschikking te stellen aan
  derden."
- **Publishing the extension is grey, leaning risky.** The data terms forbid,
  without PostNL's prior written permission, making "een directe koppeling of
  gateway" between the data on the site and other websites. A package each
  user runs for their own parcels is not obviously a gateway between sites,
  but it is a direct link to PostNL's data that PostNL did not sanction.
  Publishing is the owner's call; asking PostNL first is the clean route.
- **Company or commercial use** is allowed only as "strikt intern gebruik
  binnen uw onderneming". Anything sold, or shown to customers, falls under
  the ban on making the data available to third parties.

## What the project does

- It sends `GET`s to
  `https://tracking.postnl.nl/track-and-trace/api/trackAndTrace/<barcode>-<country>-<postal code>?language=<xx>`,
  without authentication, with `accept: application/json` and a User-Agent
  naming the client, its version and the repository
  ([`extensions/models/_lib/postnl.ts`](../../extensions/models/_lib/postnl.ts),
  [`extensions/models/postnl_parcel.ts`](../../extensions/models/postnl_parcel.ts)).
  It does not keep or send back the Akamai cookies (`_abck`, `bm_sz`) the
  answers set.
- It looks every 1800 s in transit, every 600 s once out for delivery and
  every 3600 s at a pickup point, retries a failure after 300 s (or PostNL's
  `Retry-After`), and stops when the parcel is delivered or picked up
  (`nextCheckSeconds`). Each behavior instance follows one parcel.
- It reads an allow-list. The receiver's name and street (in both
  `recipient` and `deliveryAddress`), the sender's address and contact
  person, the e-mail and phone hashes and PostNL's business-partner number
  are never written. Of the sender only `companyName` is kept.
- It never fetches the signature image (`/api/trackAndTrace/<key>/signature`)
  and never calls the reroute, pincode or feedback endpoints.

## Findings per source

### 1. robots.txt

`https://tracking.postnl.nl/robots.txt` and `https://jouw.postnl.nl/robots.txt`
are the same file, with one `User-agent: *` group. Among its disallows:

```text
Disallow: /*track-and-trace/*-*
```

That pattern matches both the human-facing tracking URLs
(`/track-and-trace/<barcode>-<country>-<postal code>`) and the API path the
tracker calls. Its evident purpose is to keep search engines from indexing
people's parcels. robots.txt is a crawler convention, not terms: "These rules
are not a form of access authorization"
([RFC 9309 §1](https://www.rfc-editor.org/rfc/rfc9309.txt)), and the tracker
is not a crawler; it looks up one known parcel. Still, it is a plain signal
that PostNL does not want automated clients on these paths, and it is worth
weighing before publishing.

### 2. Which terms govern the tracking page

The tracking front-end (`tracking.postnl.nl/track-and-trace/`, an Angular app)
links no terms of its own. PostNL's site terms are at
<https://postnl.nl/gebruiksvoorwaarden/> (EN:
<https://www.postnl.nl/en/terms-of-use/>). They cover "de PostNL Holding B.V.
internetsite welke toegankelijk is via PostNL.nl" and "de via deze Site
aangeboden internetapplicaties", which reads on the tracking app. The page
carries no date or version; only "© 2014 PostNL".

### 3. Site terms ("Voorwaarden voor het gebruik van deze website")

- Trademarks: "De handelsmerken, handelsnamen, beelden, logo's en afbeeldingen
  die de producten en diensten van PostNL" onderscheiden belong to PostNL.
  Nothing in them grants a licence: "zal niets van hetgeen hierin is vervat,
  worden uitgelegd als het verlenen van een licentie".
- Changes: "PostNL behoudt zich het recht voor te allen tijde en zonder
  vooraankondiging wijzigingen" aan te brengen.
- Automated access, bots, scraping, APIs, request rates and reverse
  engineering: **not addressed**.

### 4. Data terms ("Voorwaarden voor het gebruik van data")

These are the operative ones; the EN page calls them "a supplement to the
Terms of Use of this Website".

1. "U mag de data slechts gebruiken voor persoonlijk gebruik c.q. voor strikt
   intern gebruik binnen uw onderneming."
2. "PostNL of de partij waarvan PostNL de data betrekt, is rechthebbende op de
   auteursrechten [en] andere rechten op de data, zoals databankrechten."
3. "Het is niet toegestaan de data te verhandelen, te reproduceren of
   anderszins ter beschikking te stellen aan derden."
4. "U bent niet gerechtigd zonder voorafgaande schriftelijke toestemming van
   PostNL, anders dan door middel van een hyperlink, om een directe koppeling
   of gateway aan te brengen tussen de data op deze Site" en andere websites.
5. On abuse PostNL may withdraw the right to use the data and "de toegang tot
   het zoeken van data te verbieden en daartoe technische voorzieningen te
   treffen".
6. "PostNL behoudt zich het recht voor om deze voorwaarden zonder voorafgaande
   aankondiging te wijzigen."
7. "Op deze overeenkomst is uitsluitend het Nederlands recht van toepassing",
   with disputes before the court in The Hague.

### 5. Official API

PostNL's Shipping Status API
([developer.postnl.nl](https://developer.postnl.nl/integration-with-postnl/api-overview/send-and-track/shippingstatus-webservice/))
takes an `apikey` header and matches parcels to the caller's customer number
and customer code, answering only when they match. Live keys come through a
PostNL account manager. It is for shippers tracking their own consignments,
and does not fit a receiver. There is no sanctioned, self-serve route for a
receiver to follow their own parcel by machine.

### 6. Technical signals

- The answers set Akamai Bot Manager cookies (`_abck`, `bm_sz`). PostNL runs
  bot detection in front of the endpoint and can block clients without
  notice, as data-terms clause 5 reserves. A follow that starts failing with
  403s should be left stopped, not retried harder.
- The endpoint answers `colli: {}` for a wrong postal code or country, the
  same as for an unknown barcode, so the follow treats both as "PostNL knows
  no parcel" and stops.

## Per scenario

| | Allowed | Forbidden | Grey |
|---|---|---|---|
| **1. Personal use** | "persoonlijk gebruik" | — | robots.txt disallows the path for crawlers |
| **2. Internal company use** | "strikt intern gebruik binnen uw onderneming" | — | GDPR household exemption no longer applies |
| **3. Publish `@zhann/postnl-parcel`** | — | — | "directe koppeling of gateway" without written consent; robots.txt |
| **4. Share data, sell, customer-facing** | — | "verhandelen, reproduceren of … ter beschikking stellen aan derden" | — |

## If you publish anyway, reduce exposure

- Keep the cadence and the stop on delivery and on unknown parcels.
- Keep the allow-list; never fetch the signature.
- Say in the README that it is unofficial and for your own parcels only, and
  that the data may not be passed on. (Done.)
- Better still, ask PostNL for written permission first.
