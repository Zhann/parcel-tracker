# @zhann/bpost-parcel

Follows a bpost parcel from announcement to the doorstep. While the postman's round is live, it also
shows how many stops are left, how long a stop takes and when the van should reach you.

It reads the two public endpoints bpost's own tracking page uses, needs no account or API key, and
never writes the receiver's name, street or coordinates: the parse copies out an allow-list and
turns the van's position into a distance.

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
round is live (the rate bpost's page uses), and hourly while the parcel waits at a pickup point.

## Read what it found

Each parcel is a behavior named `bpost-<tracking code>`. Its `status` resource holds the step,
bpost's delivery window, the timeline, the stops left and the ETA:

```bash
swamp data query 'modelType == "@zhann/bpost-parcel" && specName == "status"' \
  --select content --json
```

One look without following, and hiding a delivered parcel:

```bash
swamp behavior run bpost-<tracking code> snapshot
swamp behavior run bpost-<tracking code> archive
```

## How the ETA is worked out

Every live look appends to the day's `round` resource. The time between drops in the stop count is
what one stop takes; the ETA is the stops left times the p25, median and p75 of those durations,
counted from the last drop. Until today's round has eight durations, earlier rounds of the same
round name fill in; with fewer than three, a fixed guess of two, three and five minutes a stop
stands in, and the ETA's `basis` says which it used.

## Keep the datastore local

The data says where you live and when you are home. Keep the repo on its local datastore rather than
a shared one.
