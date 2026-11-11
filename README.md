<p align="center"><img src="docs/img/logo.png" width="180" alt="A pixel-art parcel on a dotted route to a house"></p>

# Parcel tracker

Swamp workflow that follows a bpost parcel to the doorstep, with a terminal view of its stops left and ETA. It follows DHL shipments too, by DHL's own estimate. The datastore stays local, so parcel data never leaves this machine.

Unofficial: not made by, endorsed by or affiliated with bpost or DHL. It is meant for following your
own parcels, at the same pace bpost's own tracking page looks, and within DHL's API limits.

```text
 Parcels                                                                   11:30
▸ Coolblue           ● 12 stops │ Coolblue  bpack 24h pro · 17.7 kg
  Books           · in transit  │
                                │ Step     out for delivery — On the way to you
                                │ bpost    today 08:00–14:00
                                │ Round    Res-318
                                │ Stops    12 left   █▇▆▅▄
                                │ Pace     2m40 a stop (p25 1m55 · p75 3m30) · live, 14 stops
                                │ ETA      11:51–12:10 · likely 12:00 · in 30 min
                                │ Van      1.8 km away · moving
                                │ Checked  20s ago · following · next in 10s
 ↑↓ select  a add  r follow  x archive  h archived  d delete  q quit
```

## Use

```bash
deno task tui                       # PARCEL_POSTCODE=9050 pre-fills the postal code
```

`a` adds a parcel by starting its carrier's follow workflow in the background; it
keeps running after the TUI quits. A 10-digit DHL Express waybill, or a DHL
`JJD…`/`JVGL…` number, is followed with DHL and skips the postal code; any other
code with bpost. Without the TUI:

```bash
swamp workflow run @zhann/follow-parcel --input code=<tracking code> --input postcode=<postal code> --input label=<name>
swamp workflow run @zhann/follow-dhl-parcel --input code=<tracking number> --input label=<name>
```

### Without this repo

The behaviors are published on swamp-club as two packages, one per carrier, so you pull only the
carrier you get parcels from:

```bash
swamp extension pull @zhann/bpost-parcel   # bpost, no account needed
swamp extension pull @zhann/dhl-parcel     # DHL, with your own API key
```

Both bring `@zhann/parcel-report`, the parcel-at-a-glance report every method prints, as a
dependency. Their READMEs are in [packages/](packages/).

To upgrade, run `swamp extension update` with no name: it updates the carrier and the report
together. Pulling or updating a carrier by name leaves the report at the version it had.

### DHL needs an API key

DHL's tracking API wants a key, free with an app at
[developer.dhl.com](https://developer.dhl.com/api-reference/shipment-tracking)
(add the "Shipment Tracking - Unified" API to it). Store it once in the repo's
local vault (`swamp vault create local_encryption default` first, in a repo
without a `default` vault):

```bash
swamp vault put default DHL_API_KEY
```

## How it works

The `@zhann/bpost-parcel` behavior reads the two public endpoints bpost's
own tracking page uses: `/track/items` for the step, window and timeline, and
`/track/itemonroundstatus` for the stops left once the postman's round is live.
`follow` looks every 15 minutes in transit, every minute once out for delivery,
every 30 seconds while the round is live (bpost's page's own rate), hourly at a
pickup point, and returns when the parcel is delivered or picked up.

Each live look appends to the day's `round` resource. The time between drops in
the stop count is what a stop takes; the ETA is the stops left times the p25,
median and p75 of those durations, counted from the last drop. Until today's
round has eight durations, earlier rounds of the same round name fill in, and
with fewer than three a fixed 2–3–5 minute guess stands in and says so.

The receiver's name, street and coordinates are in bpost's answers and are
never written: the parse copies out an allow-list and turns the coordinates into
a distance.

The `@zhann/dhl-parcel` behavior asks DHL's Shipment Tracking - Unified API
instead. There is no postman's round to count stops on, so it shows DHL's own
delivery estimate. `follow` looks every 30 minutes in transit, every 15 once
out for delivery, and every 4 hours at a pickup point. A new key allows 250
calls a day for all its shipments together, so every look is counted, and
shipments followed at the same time look less often as the day's calls run
low. Once they are spent a shipment shows "waiting for tomorrow's DHL quota"
and looks again after midnight, Brussels time. A key with more calls a day
takes `--input dailyBudget=<calls>`. As DHL's terms ask, its status expires 30 days after the last
look, and every DHL shipment shows "Delivered by Deutsche Post DHL Group". The
parse keeps no names, no address, and no street inside a location. See
[docs/research/dhl-tos.md](docs/research/dhl-tos.md).
