# bpost terms vs. the parcel tracker

Does the parcel tracker, or the iOS Live Activity version under consideration,
break bpost's terms of use, its API or developer terms, or the Belgian/EU rules
that apply to its tracking site?

All pages were fetched on **2026-11-08**. bpost says it may change its terms
"at any time and without express notice", so re-check before relying on this.

> **Not legal advice.** This compares the project with the text bpost publishes
> and with the EU source texts. It is not a lawyer's opinion. For anything past
> personal use, ask a lawyer or bpost.

> Written when this was a work repo. Updated on 2026-11-08, when it became a
> personal project published as `@zhann/bpost-parcel`; the conclusions did not
> change.

## Verdict

- **No bpost clause forbids personal, automated use of the tracking endpoints,
  and none allows it.** The site terms (bpost's "Disclaimer", which the
  tracking page links in its footer) say nothing about bots, scraping, APIs,
  rate limits or reverse engineering. track.bpost.cloud has no robots.txt.
  bpost runs no public tracking API or developer programme for parcel
  receivers.
- **Personal use as it is today (1)** and **the iOS/APNs plan for one person
  (2)** run into no written prohibition. The clauses that touch them are a
  commitment not to make the site "less efficient", which is hard to break by
  polling one parcel at the page's own 30 s rate, and a ban on reproducing or
  processing the site "for commercial purposes", which does not apply. That
  makes them grey with low risk. They are not explicitly allowed, because the
  terms reserve "all rights not expressly granted".
- **Publishing the extension (3)** is grey. Publishing code is not covered, but
  each user then becomes a separate, unlicensed client of an undocumented
  endpoint. The extension's name and fixture also reproduce bpost's name and a
  few of its status texts.
- **Company or commercial use (4)** is **forbidden without bpost's prior
  written consent** if it means any "use for commercial purposes of the whole
  or a part of this website". The sanctioned route for business tracking is a
  bpost contract (Shipping Manager and its tracking web service), and that
  covers only the shipper's own parcels.

## What the project does (as of commit 5f3a9ff)

- It sends `GET`s to `https://track.bpost.cloud/track/items` and
  `/track/itemonroundstatus`, without authentication and with only an
  `accept: application/json` header
  ([`extensions/models/_lib/bpost.ts`](../../extensions/models/_lib/bpost.ts),
  [`extensions/models/bpost_parcel.ts`](../../extensions/models/bpost_parcel.ts)
  line 138).
- It looks every 900 s in transit, every 60 s once out for delivery, every
  30 s during a live round and every 3600 s at a pickup point, and stops when
  the parcel is delivered (`nextCheckSeconds`). Each behavior instance follows
  one parcel.
- It reads an allow-list of fields. Receiver name, street and coordinates are
  never written. The coordinates become a van-to-address distance.
- It never fetches the proof-of-delivery signature image.

## Findings per source

### 1. robots.txt

**track.bpost.cloud: there is no robots.txt.** `https://track.bpost.cloud/robots.txt`
returns HTTP 200 with `content-type: text/html` and `x-cache: Error from
cloudfront`. The body is the tracking app's HTML shell ("Track your
shipment"). That is the single-page app's catch-all fallback, not a robots
file. No crawl rules exist for this host.

**www.bpost.be** ([robots.txt](https://www.bpost.be/robots.txt), 204 KB) has a
single `User-agent: *` group. It holds the standard Drupal disallows (`/core/`,
`/profiles/`, admin, login, search) and about 2,600 `Disallow` lines for FAQ
and webform paths. Nothing in it mentions tracking or `track.bpost.cloud`, and
it cannot: its own header says "This file will be ignored unless it is at the
root of your host".

robots.txt is a crawler convention and does not set terms. RFC 9309 says:
"These rules are not a form of access authorization"
([RFC 9309 §1](https://www.rfc-editor.org/rfc/rfc9309.txt)). The tracker is not
a crawler anyway. It looks up one known item.

### 2. Which terms govern track.bpost.cloud

The tracking page sets no terms of its own. Its JS bundle
(`https://track.bpost.cloud/main.abf3bb53667d19ab4c22.js`) builds the footer
from `footerBaseURL: "//www.bpost.be/"` and translation keys. The translation
files (`https://track.bpost.cloud/assets/i18n/{en,nl,fr}.json`) resolve those
keys to these links:

| Footer link | EN | NL | FR |
|---|---|---|---|
| Disclaimer (= terms of use) | [en/disclaimer](https://www.bpost.be/en/disclaimer) | [nl/disclaimer](https://www.bpost.be/nl/disclaimer) | [fr/disclaimer](https://www.bpost.be/fr/disclaimer) |
| Terms and Conditions | [en/general-terms-and-conditions](https://www.bpost.be/en/general-terms-and-conditions) | [nl/algemene-voorwaarden](https://www.bpost.be/nl/algemene-voorwaarden) | [fr/conditions-generales](https://www.bpost.be/fr/conditions-generales) |
| Privacy | [en/privacy](https://www.bpost.be/en/privacy) | [nl/privacy](https://www.bpost.be/nl/privacy) | [fr/privacy](https://www.bpost.be/fr/privacy) |

The bpost.be terms of use are therefore the governing text, and they claim
that scope themselves (see §3).

### 3. bpost website terms of use ("Disclaimer")

Source: <https://www.bpost.be/en/disclaimer>. The NL and FR versions were
checked for the clauses quoted below. The page carries no date or version.

**Scope and acceptance.**

> "This website is made available to you subject to your unconditional
> acceptance of the terms and conditions of use … ("General Terms and
> Conditions of Use"). By accessing and using the website you unreservedly
> accept these General Terms and Conditions of Use."
>
> "These General Terms and Conditions of Use apply to this website and to all
> of bpost's internet and other network initiatives."
> (NL: "…alle internet en andere netwerkinitiatieven van bpost"; FR: "…toutes
> les initiatives de bpost relatives à Internet et à d'autres réseaux")

This wording is broad enough to cover the JSON endpoints behind the tracking
page.

**Changes.** "bpost reserves the right to amend these General Terms and
Conditions of Use at any time and without express notice."

**Copyright and reuse.** This is the operative restriction:

> "The website, including texts, layout, graphic components, presentation,
> logos, software and other components of this site, is protected by the
> intellectual property rights of bpost or its suppliers, such as copyright,
> related rights, database rights and trademark rights.
>
> The reproduction, circulation, sale, distribution, publication, adaptation,
> translation, processing and use for commercial purposes of the whole or a
> part of this website is forbidden, except with the prior written consent of
> bpost."

The EN and NL texts ("Reproductie, verspreiding, verkoop, verdeling,
publicatie, aanpassingen, vertalingen, bewerkingen en gebruik voor commerciële
doeleinden … is verboden") can be read two ways. "For commercial purposes" may
qualify only "use", or the whole list. The FR text makes it qualify every act:

> "Toute reproduction, diffusion, vente, distribution, publication,
> adaptation, traduction, tout traitement ou toute utilisation, même
> partielle, de ce site web **à des fins commerciales** est interdit(e) sauf
> accord préalable et écrit de bpost."

**User commitments.**

> "The user undertakes i) not to use the website for illegal or harmful
> purposes; ii) not to prevent access to the website, nor to disrupt or alter
> the website, nor to make the website less efficient or cause damage to the
> website, bpost, or third parties; … iv) not to compromise the intellectual
> rights present on the website; …"
>
> "bpost reserves the right … to suspend for an indefinite period of time
> access to and use of the services and data of any user who violates or fails
> to comply with these General Terms and Conditions of Use."

**Reserved rights and governing law.** "All rights not expressly granted in
this document are reserved." Disputes go "exclusively to Belgian law" and to
the Brussels courts.

**Not addressed.** The terms have no clause on automated access, bots,
scraping, crawling, APIs, request rates, reverse engineering, or personal
versus non-commercial use as such. The anti-spam and netiquette sections
cover e-mail and newsgroups. A text search of the EN page for
`robot|automat|scrap|crawl|spider|reverse|API` found nothing.

### 4. Official API or developer programme

- **Nothing for parcel receivers.** bpost's sitemap
  (<https://www.bpost.be/sitemap.xml>, 1,598 URLs) has no developer portal and
  no tracking-API page. The only API-like pages are the address
  validation/formatting web service and an e-shop plug-in page. The address
  service has its own terms, which shows that bpost writes explicit grants
  when it sanctions an API: "bpost grants the Customer the right to integrate
  the Formatting and Validation Services into its systems"
  ([Webservice – General Terms and Conditions](https://www.bpost.be/en/webservice-general-terms-and-conditions)).
  No equivalent document exists for tracking.
- **Receivers are pointed to the web page and the My bpost app.** The app's
  landing page offers "Track in the app" or "Track in Track & Trace"
  ([mybpostapp-track](https://www.bpost.be/en/mybpostapp-track)). The app
  already provides parcel notifications and a "live countdown of the amount
  of stops", which is roughly what the iOS plan rebuilds.
- **Business shippers have a contract route.** The Contractual Parcels GTC
  (January 2026) refer to "bpost business active e-services e-tracker" and the
  "B-Tracker system" for shippers
  ([GTC Contractual Parcels 2026 EN](https://www.bpost.be/sites/default/files/terms-conditions/GTC_Contractual_Parcels_2026_EN.pdf)).
  A bpost helpdesk article documents an authenticated tracking web service:
  "URI: https://api.bpost.be/services/trackedmail/item/{item_nb}/trackingInfo"
  ([bpost.freshdesk.com article 109777](https://bpost.freshdesk.com/support/solutions/articles/109777--empty-xml-tracking-info-webservice),
  last modified 2025-01-03, marked "[EMPTY]" and incomplete). bpost publishes
  no access terms for it. Third-party integrators say it requires a bpost
  contract, a signed Shipping Manager licence agreement and an account ID,
  with the tracking password requested from `shippingmanager@bpost.be`
  ([Returnista](https://platform.returnista.com/carriers/bpost/), secondary
  source). This route tracks the shipper's own consignments and does not fit
  a receiver.

**Conclusion:** no sanctioned, self-serve route exists for a receiver to
follow their own parcel by machine. For anything beyond personal use, the
route is bpost's prior written consent or a business contract.

### 5. Privacy policy (receiver data)

[General Privacy Policy](https://www.bpost.be/en/privacy), "Last revised at
12.01.26".

- bpost SA is the controller. For parcel services it processes
  "Identification data such as name, first name and signature", "Address
  details (as provided directly by the person concerned or as indicated on a
  letter or package)" and "Details of mail or parcels sent", on the basis of
  contract or bpost's legitimate interest.
- The policy has no section on the public Track & Trace page or on third
  parties who receive tracking responses. The
  [specific privacy policies](https://www.bpost.be/en/specific-privacy-policies)
  list no Track & Trace web policy either. It is **not addressed**.
- For the project, this means bpost's policy does not govern what the tracker
  does with the response. GDPR does (see the legal frame below). The
  allow-list keeps the receiver's name, street and coordinates out of storage.

### 6. My bpost app terms (context only)

These terms cover the app, not the web tracker, and the project does not use
the app. The current EN PDF
([mybpostapp_general-terms-conditions_en.pdf](https://www.bpost.be/sites/default/files/gtc/mybpostapp_general-terms-conditions_en.pdf))
could not be text-extracted: its fonts have no Unicode mapping. The 2023 FR
version
([mybpostapp_general-terms-conditions_fr_23.pdf](https://www.bpost.be/sites/default/files/terms-conditions/mybpostapp_general-terms-conditions_fr_23.pdf))
protects the app's own components ("La reproduction, la traduction, la
modification ou la diffusion de tout ou partie de ces composantes … est
interdite, sauf accord écrit préalable de bpost", §12.1). It is relevant only
if someone reverse-engineered the app itself, which this project does not do.

### 7. Technical signals in the tracking page (no endpoint calls)

These come from the page's own static JS bundle, not from the API:

- The page polls round status every 30 s
  (`itemonroundstatus_time:3e4`). The tracker's live-round cadence matches it.
- reCAPTCHA gates only the proof-of-delivery signature image (`getImage(…
  signature.refId)` after `resolved`). It does not gate `/track/items` or
  `/track/itemonroundstatus`. The tracker never fetches the signature, so it
  bypasses no access control. Keep it that way: automating that call would
  mean getting around a technical measure.

## Legal frame (pointers only)

- **Database sui generis right.** Directive 96/9/EC, Art. 7(1), lets a maker
  who made a substantial investment "prevent extraction and/or re-utilization
  of the whole or of a substantial part" of a database. Art. 7(5) adds that
  "repeated and systematic extraction … of insubstantial parts … implying acts
  which conflict with a normal exploitation of that database or which
  unreasonably prejudice the legitimate interests of the maker … shall not be
  permitted." Art. 8(1) says a lawful user may extract "insubstantial parts of
  its contents … for any purposes whatsoever". Under Art. 15, contract terms
  contrary to Art. 8 are "null and void"
  ([EUR-Lex 31996L0009](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:31996L0009)).
  Belgium transposed this in the Code of Economic Law, Book XI, Title 7
  ([WIPO Lex: 2014 law inserting Book XI](https://www.wipo.int/wipolex/en/legislation/details/19264),
  an older, superseded version). One
  parcel's status is an insubstantial part. Polling it every 30 s on the
  day of delivery is "repeated", but it is what bpost's own page does for that
  same parcel and does not obviously "conflict with normal exploitation".
- **Contract terms still bind where the right does not apply.** If the
  tracking data is protected by neither copyright nor the sui generis right,
  the Directive "do[es] not preclude the author of such a database from laying
  down contractual limitations on its use by third parties"
  ([CJEU C‑30/14 Ryanair v PR Aviation](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62014CJ0030)).
  bpost's terms of use (§3) matter either way.
- **GDPR.** The Regulation does not apply to processing "by a natural person
  in the course of a purely personal or household activity" (Art. 2(2)(c)).
  Recital 18 adds: "However, this Regulation applies to controllers or
  processors which provide the means for processing personal data for such
  personal or household activities"
  ([EUR-Lex 32016R0679](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679)).

## Per scenario

| | Explicitly allowed | Explicitly forbidden | Not addressed / grey |
|---|---|---|---|
| **1. Personal use today** | Nothing. "All rights not expressly granted … are reserved." | Nothing that applies. The ban is on commercial use, and one parcel at the page's rate is unlikely to make the site "less efficient". | Whether calling the JSON endpoints directly counts as "use of the website" (probably yes, under the scope clause). GDPR household exemption applies. |
| **2. iOS Live Activity via APNs, one person** | Nothing. | Nothing new. bpost sees the same traffic as in 1. | Showing bpost's step texts in your own app is "reproduction … of a part" of the site. That is forbidden only commercially under the FR reading, and ambiguous in EN/NL. |
| **3. Publish `@zhann/bpost-parcel`** | Nothing. | Nothing on publishing code. | Others become unlicensed clients, load multiplies, and the name and fixture reproduce bpost's name and texts. |
| **4. Company / commercial use** | Only with bpost's prior written consent, or a business contract for your own shipments. | "Use for commercial purposes of the whole or a part of this website" without "prior written consent". | Internal, non-sale use inside a company. |

### 1. Personal use as it is today

- **Allowed:** nothing explicit. The terms grant no right to machine access
  and reserve every right they do not grant.
- **Forbidden:** nothing that applies. The commercial-use ban does not reach a
  person tracking their own parcel. User commitment ii ("not to … make the
  website less efficient") is the clause most likely to be cited against bots.
  Even at its fastest, the tracker sends one request per 30 s for one parcel,
  only during a live round, which is the page's own rate
  (`itemonroundstatus_time:3e4`). A browser tab left open does the same.
- **Grey:** the terms never say whether calling the page's back-end directly,
  rather than through the page, is "use of the website". They do claim to
  cover "all of bpost's internet and other network initiatives", so assume
  they apply. On database rights, see the legal frame above. On GDPR, a person
  tracking parcels addressed to themselves or their household falls under
  Art. 2(2)(c), and the allow-list keeps the receiver data out of storage in
  any case.

### 2. iOS Live Activity via APNs (same polling, one person)

- bpost sees the same traffic as in scenario 1. The Linux box polls, and
  APNs sits downstream of bpost. No bpost clause turns on where the result is
  displayed. Same assessment as 1.
- **New, grey:** the iOS app shows bpost's status and event texts, which is a
  "reproduction … of a part of this website". Under the FR text this is
  forbidden only "à des fins commerciales". The EN/NL texts are ambiguous.
  Use that is private and undistributed (a personal or TestFlight build) is
  the least exposed. Do not use bpost's logo or brand in the app (the terms
  name "logos" and "trademark rights").
- **GDPR:** only allow-listed fields (stops, distance, ETA, step text) go
  through Apple's APNs. No receiver name, address or coordinates leave the
  box. That stays inside the household exemption.
- If the iOS app were ever **distributed** (App Store, other users), it
  becomes scenario 3 or 4.

### 3. Publishing the extension publicly

- **Forbidden:** nothing in the terms covers publishing code that calls the
  endpoints. The code contains no bpost content beyond endpoint paths and
  field names.
- **Grey:**
  - Every user becomes a separate client of an undocumented, unlicensed
    endpoint. Each one falls under scenario 1 (or 4) in their own right. The
    "less efficient" commitment, and bpost's right to "suspend … access to and
    use of the services and data", apply per user. bpost can also change or
    block the endpoints without notice, because no API contract exists.
  - The fixture
    [`extensions/models/fixtures/items_out_for_delivery.json`](../../extensions/models/fixtures/items_out_for_delivery.json)
    copies the structure of bpost's response and a few status strings ("Zending
    wordt voorbereid door de postbode"). That is a "reproduction … publication
    … of a part" of the site, though a trivial one. A personal, free, MIT
    release is hard to read as commercial, even under the FR reading.
  - The name `@zhann/bpost-parcel` uses bpost's trademark descriptively.
    The terms reserve "trademark rights" and do not address descriptive use.
  - GDPR: recital 18 brings into scope those who "provide the means for
    processing" for household users. A package that runs on the user's own
    machine is closer to software than a service. If someone hosted it for
    others, that sentence would apply.
- **If you publish anyway, reduce exposure:**
  - Keep the current cadence and the stop-on-delivered behaviour.
  - Keep the allow-list, and never add a signature fetch.
  - Say in the README that it is unofficial, not affiliated with bpost, and
    for tracking your own parcels.
  - Consider an identifying `User-Agent`.
  - Better still, ask bpost first.

### 4. Company or commercial use

- **Forbidden without consent:** "use for commercial purposes of the whole or
  a part of this website is forbidden, except with the prior written consent
  of bpost." This covers any product, paid service, or customer-facing feature
  built on these endpoints. bpost may also suspend access.
- **Sanctioned route:** bpost's written consent, or the business contract
  route in §4, which covers only parcels you ship yourself.
- **Grey:** internal operational use inside a company that sells nothing, for
  example following office deliveries. This is not clearly "commercial
  purposes", but it is professional use. The GDPR household exemption no
  longer applies, so the company would be a controller for whatever it keeps.
  The allow-list helps, but get consent or legal sign-off before doing this.

## Sources not reachable or not usable

- **track.bpost.cloud/robots.txt:** no file. The host serves the app's HTML
  with a CloudFront `Error` cache status.
- **Terms of use specific to track.bpost.cloud:** none exist. The page links
  to bpost.be's.
- **Current My bpost app GTC (EN PDF):** downloaded, but the text could not be
  extracted. The 2023 FR version was used instead (context only).
- **Official tracking web service documentation and terms:** not published.
  The only first-party item is an incomplete helpdesk stub. Access
  requirements come from third-party integrators.
- **Belgian Code of Economic Law Book XI, Title 7:** located through WIPO Lex,
  not quoted from Justel. Article numbers are not cited here.
