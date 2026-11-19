# @zhann/postnl-parcel

Follows a PostNL parcel until it is delivered or picked up, by PostNL's own delivery window. It
works for parcels PostNL delivers in Belgium as well as in the Netherlands.

It reads the endpoint PostNL's own tracking page uses, needs no account or API key, and never writes
the receiver's name or street, nor the hashes of their e-mail address and phone number: the parse
copies out an allow-list, and of the sender only its company name.

Unofficial: not made by, endorsed by or affiliated with PostNL. It is meant for following your own
parcels, which PostNL's terms allow ("persoonlijk gebruik"); see [PostNL's terms](#postnls-terms)
below.

For bpost or DHL parcels, pull `@zhann/bpost-parcel` or `@zhann/dhl-parcel` instead (or as well);
they show the same report.

## Follow a parcel

PostNL answers only for the barcode together with the delivery address's postal code and country.
The country is read from the postal code: `1234 AB` is Dutch, four digits Belgian, `L-1234` from
Luxembourg. Any other postal code needs `--input country=<two letters>`.

```bash
swamp extension pull @zhann/postnl-parcel
swamp workflow run @zhann/follow-postnl-parcel \
  --input code=<barcode> --input postcode=<postal code> --input label=<name>
```

The `@zhann/follow-postnl-parcel` workflow looks once, so a wrong barcode or postal code fails
straight away, then keeps looking until the parcel is delivered or picked up. `--input language=NL`
(or `FR`, `DE`) asks for PostNL's texts in that language; picked up at a pickup point is only
recognised in English and Dutch.

## Pacing

PostNL shows no round to count stops on, only a window, so `follow` looks every 30 minutes in
transit, every 10 once the parcel is on its way to the address, and hourly while it waits at a
pickup point. A failed look is tried again 5 minutes later, or after PostNL's `Retry-After` when
that is longer; a parcel PostNL does not know, or 30 failed looks in a row, end the follow. The run
lasts as long as the parcel's journey (`maxHours`, 120 by default). Every request says who is
asking: `parcel-tracker/<version> (+https://github.com/zhann/parcel-tracker)`.

## Where is it now?

Each parcel is a behavior named `postnl-<barcode>`, in lower case. `snapshot` looks once and prints
the `@zhann/parcel-report` report, which comes with this package as a dependency and runs after
every method:

```bash
swamp behavior run postnl-<barcode> snapshot
```

```text
## Tickets — in transit

Shipment received by PostNL · Parcel · 0.2 kg

- **PostNL** today
- **Checked** 07:20 · not following

### Timeline

- 18/11 23:28 · Delivery cannot be changed
- 18/11 23:27 · Shipment received by PostNL
- 18/11 20:31 · Delivery cannot be changed
- 18/11 20:31 · Pre-alerted shipment enriched by PostNL management.
```

Times are Brussels time. The `status` resource holds everything behind the report:

```bash
swamp report get @zhann/parcel-report --behavior postnl-<barcode> --markdown
swamp data query 'modelType == "@zhann/postnl-parcel" && specName == "status"' \
  --select content --json
```

Hide a delivered parcel with `swamp behavior run postnl-<barcode> archive`.

## PostNL's terms

PostNL's terms for data on its site allow it to be used "slechts … voor persoonlijk gebruik c.q.
voor strikt intern gebruik binnen uw onderneming", and forbid trading it, reproducing it or making
it available to others. So:

- **Your own parcels only**, for yourself or strictly inside your own company.
- **Don't pass the data on**: no sharing the report, no feeding it into a service for others.

The same terms say a "directe koppeling of gateway" between PostNL's data and other sites needs
PostNL's written permission. Each user runs this package on their own machine for their own parcels,
but PostNL may read it differently; it can also block clients of its tracking page without notice.

This is a summary, not legal advice. The full reading is in the repository's
[docs/research/postnl-tos.md](https://github.com/zhann/parcel-tracker/blob/main/docs/research/postnl-tos.md).

## Upgrade

Run `swamp extension update` with no name. It updates every extension the repo has pulled, so this
package and `@zhann/parcel-report` move up together, and it asks nothing:

```bash
swamp extension update --check   # what is behind
swamp extension update
```

Pulling or updating `@zhann/postnl-parcel` by name upgrades this package only. The report stays at
the version it had until it is pulled or updated by its own name.

## Keep the datastore local

The data says where you live and when you are home. Keep the repo on its local datastore rather than
a shared one.
