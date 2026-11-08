<p align="center"><img src="docs/img/logo.png" width="180" alt="A pixel-art parcel on a dotted route to a house"></p>

# Parcel tracker

Swamp workflow that follows a bpost parcel to the doorstep, with a terminal view of its stops left and ETA. The datastore stays local, so parcel data never leaves this machine.

Unofficial: not made by, endorsed by or affiliated with bpost. It is meant for following your own
parcels, at the same pace bpost's own tracking page looks.

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

`a` adds a parcel by starting the `@zhann/follow-parcel` workflow in the background; it
keeps running after the TUI quits. Without the TUI:

```bash
swamp workflow run @zhann/follow-parcel --input code=<tracking code> --input postcode=<postal code> --input label=<name>
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
