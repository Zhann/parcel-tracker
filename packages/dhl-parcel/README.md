# @zhann/dhl-parcel

Follows a DHL shipment until it is delivered, by DHL's own delivery estimate. It asks DHL's official
Shipment Tracking - Unified API with your own API key, and never writes the receiver's name or
address.

Unofficial: not made by, endorsed by or affiliated with DHL. It is meant for following your own
shipments, within the limits DHL sets for your key.

## Bring your own key

DHL's tracking API wants a key. It is free: create an app at
[developer.dhl.com](https://developer.dhl.com/api-reference/shipment-tracking) and add the "Shipment
Tracking - Unified" API to it. Creating the app is where you accept DHL's terms for the API; this
package does not accept them for you, and everything it asks DHL counts against your key.

The workflow reads the key from the repo's `default` vault as `DHL_API_KEY`. Create the vault if the
repo has none, then store the API key (the key only, not the secret), which is asked for with hidden
input:

```bash
swamp vault create local_encryption default
swamp vault put default DHL_API_KEY
```

## Follow a shipment

The `@zhann/follow-dhl-parcel` workflow looks once, so a wrong number or a rejected key fails
straight away, then keeps looking until the shipment is delivered:

```bash
swamp extension pull @zhann/dhl-parcel
swamp workflow run @zhann/follow-dhl-parcel --input code=<tracking number> --input label=<name>
```

DHL usually finds the service from the number alone. If it does not, pass `--input service=express`
(or `parcel-de`, `ecommerce`, …), and for DHL Parcel Germany or the Netherlands
`--input postcode=<postal code>`. `--input language=NL` (or `FR`, `DE`) asks for DHL's texts in that
language; out for delivery and pickup points are only recognised in English.

## Pacing

A new key allows 250 calls a day and one every 5 seconds. `follow` looks every 30 minutes in
transit, every 15 once the shipment is out for delivery and every 4 hours while it waits at a pickup
point, so one shipment stays under 100 calls a day. The limit is your key's and the pacing is per
shipment: several followed at once share the 250, and when DHL says the key has had enough, `follow`
waits as long as DHL asks. It leaves at least 6 seconds after the workflow's first look, tries a
failed look again 5 minutes later (or after DHL's `Retry-After`, when that is longer), and stops on
a number DHL does not know, a request DHL refuses (a rejected key, a malformed number), or 30 failed
looks in a row. The run lasts as long as the shipment's journey (`maxHours`, 240 by default). Every
request says who is asking: `parcel-tracker/<version> (+https://github.com/zhann/parcel-tracker)`.

## Where is it now?

Each shipment is a behavior named `dhl-<tracking number>`. `snapshot` looks once and prints the
`@zhann/parcel-report` report, which comes with this package as a dependency and runs after every
method:

```bash
swamp behavior run dhl-<tracking number> snapshot
```

```text
## Lamp — out for delivery

Shipment is out with courier for delivery · EXPRESS WORLDWIDE · 1.2 kg

- **DHL** today 09:00–18:00
- **Checked** 10:59 · following, next look 11:14

### Timeline

- 06/11 08:12 · GENT · Shipment is out with courier for delivery
- 06/11 05:40 · GENT · Arrived at Delivery Facility
- 05/11 22:03 · BRUSSELS · Departed Facility

_Delivered by Deutsche Post DHL Group_
```

Times are Brussels time. The `status` resource holds everything behind the report:

```bash
swamp report get @zhann/parcel-report --behavior dhl-<tracking number> --markdown
swamp data query 'modelType == "@zhann/dhl-parcel" && specName == "status"' --select content --json
```

Hide a delivered shipment with `swamp behavior run dhl-<tracking number> archive`.

## DHL's terms

What DHL asks of tracking data, and what this package does about it:

- **Your own tracking only.** Use it for your own shipments, or your customers'. Don't share the
  data with others, combine it with advertising or mine it for competitive insight.
- **Delete it 30 days after delivery.** The `status` resource expires 30 days after the last look,
  and a follow takes its last look at delivery.
- **Credit DHL.** Wherever the data is shown, it says "Delivered by Deutsche Post DHL Group". The
  report does; anything else you show it in should too.

DHL's answers can carry the receiver's and sender's names, the address and who signed. The parse
copies out an allow-list: the sender's organisation name, the town of each location, and event texts
without "signed for by …".

This is a summary, not legal advice: the terms you accepted with your key are the ones that count.

## Keep the datastore local

The data says where you live and when you are home. Keep the repo on its local datastore rather than
a shared one.
