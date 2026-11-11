# @zhann/parcel-report

The parcel at a glance, after every method of a `@zhann/bpost-parcel` or `@zhann/dhl-parcel`
behavior: the step, the carrier's window, the stops left and ETA while a bpost round is live, and
the latest events.

Both carrier packages depend on this one, so pulling either brings it along; there is nothing to
configure. It reads the behavior's `status` resource and asks nothing of the network.

Upgrading a carrier by name does not upgrade this report with it. `swamp extension update`, with no
name, upgrades both.

```bash
swamp behavior run bpost-<tracking code> snapshot     # prints the report
swamp report get @zhann/parcel-report --behavior bpost-<tracking code> --markdown
```

```text
## Desk — out for delivery

On the way to you · bpack 24h pro · 0.5 kg

- **ETA** 11:30, in 30 min (11:21–11:40)
- **Stops** 12 left · round Res-318
- **Van** 1.8 km away
- **Pace** 2m40 a stop (p25 1m55 · p75 3m30) · live, 14 stops
- **bpost** today 11:10–14:15
- **Checked** 10:59 · following, next look 11:00
```

Times are Brussels time. Its JSON half is a flat digest to script against (`carrier`, `phase`,
`stopsLeft`, `eta.minutesFromNow`, `error`, …). A DHL shipment always ends with "Delivered by
Deutsche Post DHL Group", the credit DHL's terms ask for.

Unofficial: not made by, endorsed by or affiliated with bpost or DHL.
