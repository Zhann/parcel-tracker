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
| A new key: 250 calls a day, at most one every 5 seconds; more on request. | `follow` looks every 30 min in transit, 15 min out for delivery, 4 h at a pickup point (≤ 96 calls a day per shipment). It leaves at least 6 s after the workflow's snapshot, retries after 5 min, and honours `Retry-After` on a 429. |
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

## Open points

- The reference page's wording was read through a summary tool. Check the
  exact attribution text, and the terms behind the app's key, against the
  terms page itself.
- The fixture is synthetic: shaped like DHL's documented sample, with made-up
  people and streets. Swap it for a scrubbed real answer once a key exists.
