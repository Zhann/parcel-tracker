# DHL terms vs. the parcel tracker

What the `@zhann/dhl-parcel` behavior has to respect to use DHL's Shipment
Tracking - Unified API. Read from the API's reference page
(<https://developer.dhl.com/api-reference/shipment-tracking>, v1.5.8) on
**2026-11-08**. This is a short note, not the full review
[bpost-tos.md](bpost-tos.md) is. Re-read the page, and the terms you accept
when you create the app, before relying on it.

> **Not legal advice.** For anything past following your own parcels, read
> DHL's terms in full or ask DHL.

## How it is accessed

- **Official API, with a key.** Unlike bpost, DHL runs a public tracking API.
  A key comes free with an app at developer.dhl.com, and the request sends it
  in the `DHL-API-Key` header. The behavior uses that API and nothing else: it
  does not scrape dhl.com.
- **The key is a secret.** It lives in the repo's local `default` vault as
  `DHL_API_KEY`, and the behavior's `apiKey` argument is marked sensitive.

## What the terms ask, and what the behavior does about it

| DHL asks | The behavior |
| --- | --- |
| A new key: 250 calls a day, at most one every 5 seconds; more on request. | `follow` looks every 30 min in transit, 15 min out for delivery, 4 h at a pickup point (≤ 96 calls a day per shipment). Every look (snapshots and retries too) is counted per Brussels day across all DHL shipments; follows look less often to share the calls left, and none looks once `dailyBudget` (250) is spent, until after midnight. The count is not locked: looks by follows in the same moment are allowed for, two snapshots racing for the day's last call are not. It leaves at least 6 s after the workflow's snapshot (not between different shipments), retries after 5 min, and honours `Retry-After` on a 429. |
| Use tracking data only for your own, or your customers', tracking. | It follows your own shipments. Nothing is sent anywhere. |
| Don't share it with third parties, combine it with advertising, or mine it for competitive insight. | The datastore stays local (see CLAUDE.md). There is no advertising and no analysis beyond the one shipment. |
| Delete tracking data 30 days after delivery, unless agreed otherwise. | The `status` resource has a `30d` lifetime. A follow takes its last look at delivery, so that look expires about 30 days after it. A shipment only ever `snapshot`ed expires 30 days after that snapshot. |
| Show "Delivered by Deutsche Post DHL Group" wherever the data is shown to recipients or customers. | The report and the TUI show that line under every DHL shipment. |

## Receiver data

DHL's answers can carry the receiver's and sender's names, the destination
address, and after delivery the name of whoever signed. `_lib/dhl.ts` copies
out an allow-list: it keeps the sender's organisation name only, keeps only the
town of each location (`addressLocality` can include a street), and cuts
"signed for by …" from event texts.

## Publishing `@zhann/dhl-parcel`

Re-checked on **2026-11-09** for publishing the behavior as its own swamp-club
package ([#3](https://github.com/zhann/parcel-tracker/issues/3)), against
developer.dhl.com's General Developer Portal Terms of Use, read in a browser
that day (DHL's pages refuse automated fetches). The API reference page above
was not re-read; its Services Specifics take precedence over the Terms of Use
where the two differ ("Order of Precedence").

Publishing the code is not using the API. What changes is who uses it:

- **Each user brings their own key, and accepts DHL's terms themselves.** The
  terms are accepted by registering and "by requesting the API Sandbox Key
  and/or the API Productive Key", and a key may not be made "available to any
  third parties". So the package ships no key and cannot share one: the key is
  read from the user's own `default` vault and the `apiKey` argument stays
  sensitive. The package README sends users to developer.dhl.com for their own
  app, says that is where they accept the terms, and tells them not to share
  the key.
- **The limits are per key, and so is the count.** "Each account contains a
  limit for API calls." Every look is counted against `dailyBudget` (250) across
  the DHL shipments in the user's own repo (see the table above), so a key used
  only there stays within its day. The count cannot see calls the same key
  makes from another repo or machine, nor two snapshots racing for the last
  call; DHL's 429 is then the backstop, and `follow` waits for `Retry-After`
  (at least 5 minutes) rather than retrying sooner. It never tries to get
  around a limit. The README says all of this.
- **The other obligations travel with the code.** The `30d` lifetime keeps
  deleting tracking data in each user's own datastore, and the report, now in
  `@zhann/parcel-report`, prints "Delivered by Deutsche Post DHL Group" under
  every DHL shipment for every user. The TUI is not published; the README asks
  that anything else showing the data carries the credit too. "No other
  recipients" and own-tracking use are the user's to keep; the README lists
  them.
- **No DHL data ships.** The package holds `dhl_parcel.ts` and the modules it
  imports, the workflow, README and LICENSE (the dry run's file list). The
  synthetic fixture stays in the repo.
- **Requests identify the client, not the user.** The User-Agent names
  `parcel-tracker/<version>` and the repository, nothing about whoever runs it.

### Where the Terms of Use pull the other way

None of these forbids publishing a client that each user runs with their own
key, but each is a risk to weigh, for the package and for whoever runs it:

- **DHL's name.** "No license to use any of these trademarks is given or
  implied ... These trademarks may not be copied, downloaded, reproduced, used,
  modified or distributed in any way without prior written permission." "dhl"
  is in the package's name, labels and README, used only to say what it tracks,
  with the README saying it is unofficial and not affiliated. That is
  descriptive use, as for bpost in [bpost-tos.md](bpost-tos.md), but this
  clause binds the account holder publishing it, and no permission was asked.
  If DHL objects, rename the package (`@zhann/dhl-parcel` can be deprecated in
  favour of a new name) rather than argue.
- **"Bots, Crawlers".** Read literally ("use any automated systems and/or
  software ... to access ... an API or to ... retrieve Content from ... an
  API"), it forbids any automated use of an API, which an API exists for. Read
  with its examples (crawlers, spiders, scraping) and its second limb
  ("override ... call limits"), it is aimed at scraping and limit evasion.
  `follow` is automated polling at DHL's documented rates; it applies whether
  or not the code is published.
- **"No Modification" vs. data minimisation.** The parse drops the receiver's
  name and address, keeps only the town of a location, and cuts "signed for by
  …" out of event texts. Dropping fields is not modifying them, but cutting a
  name out of a text is, and the terms allow it only "unless required by law".
  The GDPR's data minimisation is the reason for it; keep it.
- **"Restricted Caching/Storing".** Content may be stored only when "technically
  necessary" and "temporary", and deleted "as soon as possible after ...
  completion of communication to an end user". The `status` resource keeps the
  last look, and up to 20 earlier versions, for 30 days: the Services
  Specifics' deletion period, which prevails. Lower `garbageCollection` if DHL
  ever reads it more strictly.
- **"Competition".** An application may not "substantially replicate ...
  clients" of DHL's services. A personal follower that shows DHL's own estimate
  in a terminal is not a replacement for DHL's tracking, but it is a client.

## Open points

- Re-read the API reference page (the Services Specifics: 250 calls a day, the
  30-day deletion, the exact attribution text) in a browser; it was last read
  through a summary tool on 2026-11-08.
- The fixture is synthetic: shaped like DHL's documented sample, with made-up
  people and streets. Swap it for a scrubbed real answer once a key exists.
