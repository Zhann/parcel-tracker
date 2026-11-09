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
package ([#3](https://github.com/zhann/parcel-tracker/issues/3)). DHL's pages answered an automated fetch with "The requested
URL was rejected", so this rests on the 2026-11-08 reading above; nothing in it
changed.

Publishing the code is not using the API. What changes is who uses it:

- **Each user brings their own key, and accepts DHL's terms themselves.** The
  key is read from the user's own `default` vault; none ships with the package,
  and the `apiKey` argument stays sensitive. The package README sends users to
  developer.dhl.com to create their own app, says that is where they accept the
  terms, and that every call counts against their key.
- **The limits are per key, the pacing per shipment.** One shipment stays under
  100 calls a day; a key following several at once can still reach 250. DHL
  then answers 429, and `follow` waits for `Retry-After` (at least 5 minutes)
  rather than retrying sooner. The README says the pacing is per shipment.
- **The other obligations travel with the code.** The `30d` lifetime keeps
  deleting tracking data in each user's own datastore, and the report, now in
  `@zhann/parcel-report`, prints "Delivered by Deutsche Post DHL Group" under
  every DHL shipment for every user. The TUI is not published; the README asks
  that anything else showing the data carries the credit too. Own-tracking use
  and not sharing the data are the user's to keep; the README lists them.
- **No DHL data ships.** The package holds `dhl_parcel.ts` and the modules it
  imports, the workflow, README and LICENSE (the dry run's file list). The
  synthetic fixture stays in the repo.
- **DHL's name is used descriptively.** "dhl" names what the package tracks, in
  its name and labels; the README says it is unofficial and not affiliated with
  DHL, as for bpost in [bpost-tos.md](bpost-tos.md).
- **Requests identify the client, not the user.** The User-Agent names
  `parcel-tracker/<version>` and the repository, nothing about whoever runs it.

## Open points

- DHL's pages refused an automated re-read on 2026-11-09. Read the API reference
  and developer.dhl.com's terms of use in a browser, and check that they allow a
  published client that each user runs with their own key.

- The reference page's wording was read through a summary tool. Check the
  exact attribution text, and the terms behind the app's key, against the
  terms page itself.
- The fixture is synthetic: shaped like DHL's documented sample, with made-up
  people and streets. Swap it for a scrubbed real answer once a key exists.
