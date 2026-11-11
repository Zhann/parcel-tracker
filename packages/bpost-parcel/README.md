# @zhann/bpost-parcel

Follows a bpost parcel from announcement to the doorstep. While the postman's round is live, it also
shows how many stops are left, how long a stop takes and when the van should reach you.

It reads the two public endpoints bpost's own tracking page uses, needs no account or API key, and
never writes the receiver's name, street or coordinates: the parse copies out an allow-list and
turns the van's position into a distance.

Unofficial: not made by, endorsed by or affiliated with bpost. It is meant for following your own
parcels, at the same pace bpost's own tracking page looks.

For DHL shipments, pull `@zhann/dhl-parcel` instead (or as well); it shows the same report.

## Follow a parcel

The `@zhann/follow-parcel` workflow looks once, so a wrong code or postal code fails straight away,
then keeps looking until the parcel is delivered or picked up:

```bash
swamp extension pull @zhann/bpost-parcel
swamp workflow run @zhann/follow-parcel \
  --input code=<tracking code> --input postcode=<postal code> --input label=<name>
```

The run lasts as long as the parcel's journey (`maxHours`, 120 by default). It looks every 15
minutes in transit, every minute once the parcel is out for delivery, every 30 seconds while the
round is live (the rate bpost's page uses), and hourly while the parcel waits at a pickup point. A
failed look is tried again a minute later, or later still if bpost answers with `Retry-After`. Every
request says who is asking: `parcel-tracker/<version> (+https://github.com/zhann/parcel-tracker)`.

## Where is it now?

Each parcel is a behavior named `bpost-<tracking code>`. `snapshot` looks once and prints the
`@zhann/parcel-report` report, which comes with this package as a dependency and runs after every
method:

```bash
swamp behavior run bpost-<tracking code> snapshot
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

Times are Brussels time. The last report is kept, and the `status` resource holds everything behind
it:

```bash
swamp report get @zhann/parcel-report --behavior bpost-<tracking code> --markdown
swamp data query 'modelType == "@zhann/bpost-parcel" && specName == "status"' \
  --select content --json
```

Hide a delivered parcel with `swamp behavior run bpost-<tracking code> archive`.

## How the ETA is worked out

Every live look appends to the day's `round` resource. The time between drops in the stop count is
what one stop takes; the ETA is the stops left times the p25, median and p75 of those durations,
counted from the last drop. Until today's round has eight durations, earlier rounds of the same
round name fill in; with fewer than three, a fixed guess of two, three and five minutes a stop
stands in, and the ETA's `basis` says which it used.

## Upgrade

Run `swamp extension update` with no name. It updates every extension the repo has pulled, so this
package and `@zhann/parcel-report` move up together, and it asks nothing:

```bash
swamp extension update --check   # what is behind
swamp extension update
```

Pulling or updating `@zhann/bpost-parcel` by name upgrades this package only. The report stays at
the version it had until it is pulled or updated by its own name.

## Keep the datastore local

The data says where you live and when you are home. Keep the repo on its local datastore rather than
a shared one.
