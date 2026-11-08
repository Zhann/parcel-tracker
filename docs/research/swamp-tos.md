# Swamp terms vs. the parcel tracker and the iOS plan

Researched 2026-11-08 against swamp's own sources: the GitHub repo at commit
[`f4852124`](https://github.com/swamp-club/swamp/tree/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29),
the legal pages on swamp-club.com (swamp.club redirects there), the swamp
manual, and the installed CLI (`swamp 20261025.114930.0-sha.b4dd513d`). This is
a reading of the documents, not legal advice.

> Written when this was a work repo. Updated on 2026-11-08, when it became a
> personal project published as `@zhann/bpost-parcel`; the conclusions did not
> change.

## Verdict

None of the four plans breaks the license or a usage rule on its face. The
code-level questions all come out fine. What remains is the **plan**:

- **The plan, not the code.** The account that runs swamp here is on a
  **Personal License**, which swamp describes as "free, for use outside of
  work. Work use needs a paid plan". This is a personal project under the
  `@zhann` collective, so the Personal License fits, as long as it stays out of
  work use. The software licence limits use to the Product Description, so this
  is a term of the licence, not just a pricing page.
- **(1) The project today:** no conflict with the licence or the acceptable-use
  terms.
- **(2) Option B (personal box, APNs, iOS Live Activity):** no conflict. Running
  unmodified swamp is allowed without limit. The APNs code is your own extension
  code, which the exception covers. The iOS app talks to your box, not to swamp,
  so swamp is never redistributed. Running it on a personal box for your own
  parcels is what the Personal License is for.
- **(3) Publishing to the registry:** allowed, under any license you choose.
  You must declare a license, the code is public by default, and you give swamp
  a perpetual licence to it. You also warrant that the extension breaks no
  third-party rights or laws, and you indemnify swamp. That warranty is where
  bpost's terms come in. `@zhann/bpost-parcel` is published personally, under MIT.
- **(4) A home-made HTTP wrapper around swamp:** the grey area. The AGPL does
  not stop it because swamp is not modified, but the software licence's
  definition of "Derivative Work" includes software that "exposes to third
  parties the functionalities of the Licensed Software". For your own phone this
  is a stretch. For other people it gets close. The documented route is
  `swamp serve` with a `--webhook`, which avoids the question entirely.

## Which documents apply

Two layers apply to swamp, and they say different things:

- **The source code** is AGPLv3 with the Swamp Extension and Definition
  Exception
  ([LICENSE L4-L8](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/LICENSE#L4-L8),
  [COPYRIGHT L5-L10](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/COPYRIGHT#L5-L10)).
- **The `swamp` binary we install** is swamp's commercial build, and a
  separate Software License Agreement (SLA) governs it:
  > "Swamp itself is a commercial product produced from the open source
  > software, exclusively by Elder Swamp Club, Inc. It is distributed under our
  > software license agreement."
  > — [OSS-FAQ.md L7-L11](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/OSS-FAQ.md#L7-L11)

  > "Swamp is free software under the AGPLv3, but it is distributed under the
  > terms of our software license agreement — by using Swamp, you agree to these
  > terms." — [Pricing FAQ](https://swamp-club.com/pricing)

Other documents that apply:

- [Website Terms of Use](https://swamp-club.com/terms-of-use) (VERSION
  20261013). Its §5 is the only acceptable-use policy. Separate pages at
  `/terms`, `/acceptable-use` and `/acceptable-use-policy` return 404.
- [Extension Registry Terms](https://swamp-club.com/extension-registry-terms)
  (VERSION 20261012).
- [Privacy Policy](https://swamp-club.com/privacy-policy) (last updated July 30,
  2026).
- [Trademark policy](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/TRADEMARKS.md)
  and
  [CONTRIBUTING.md](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/CONTRIBUTING.md).
  There is no CLA. Code contributions come only from swamp employees. If you
  put source code in a bug report, you "grant a full copyright license to Elder
  Swamp Club, Inc."
  ([L12-L14](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/CONTRIBUTING.md#L12-L14)).

## License: what it allows and restricts

### AGPLv3 with the exception (the source)

| Use | Status | Source |
| --- | --- | --- |
| Run unmodified, any purpose, including commercial or internal | **Explicitly allowed**: "This License explicitly affirms your unlimited permission to run the unmodified Program." | [COPYING L144-L147](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/COPYING#L144-L147) |
| Run as a backend that others use over a network | Allowed. §13 obligations start only "if you modify the Program". Unmodified swamp behind an app triggers nothing. | [COPYING L540-L548](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/COPYING#L540-L548) |
| Write extensions/workflows under any license, proprietary included | **Explicitly allowed** if they (1) add to or configure swamp, (2) work with unmodified official swamp, (3) use only the extension API or definition schemas, and (4) "do not include copies of any Swamp source code". | [COPYING-EXCEPTION L9-L26](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/COPYING-EXCEPTION#L9-L26) |
| An extension that "becomes a practical substitute for Swamp", e.g. one that re-exposes "large parts of Swamp's extension API via a new API" | **Excluded from the exception**, so it falls back to plain AGPL | [COPYING-EXCEPTION L28-L38](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/COPYING-EXCEPTION#L28-L38) |
| Modify or redistribute your own build | Allowed under the AGPL, but you must remove the trademarks and stop using swamp-club services | [OSS-FAQ L21-L31, L57-L60](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/OSS-FAQ.md#L21-L60) |
| Trademarks | Not licensed under AGPL §7. Nominative use such as "works with Swamp software" is fine. | [TRADEMARKS L136-L150](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/TRADEMARKS.md#L136-L150) |

Our extension meets the exception's conditions. `bpost_parcel.ts` imports only
`npm:zod@4` and its own `_lib/` files, so no swamp source is copied in. The TUI
is a separate program that runs the `swamp` CLI.

### Software License Agreement (the binary)

[SLA](https://swamp-club.com/software-license-agreement), VERSION 20261013:

- **§2.1:** the license is "to use the Licensed Software solely according to
  the Product Description, and in a manner consistent with the Documentation".
  "Product Description" (§1) means the description "made available on the
  Company website … and the use limitations applicable thereto". The pricing
  page is that description.
- **§2.2 restrictions.** You may not "(c) sublicense, assign, delegate, rent,
  lease, sell, time-share or otherwise transfer the benefits of, use under, or
  rights to, the license", nor "(e) modify, translate or create Derivative Works
  of the Licensed Software without the prior written consent of Company", nor
  "(g) combine or distribute any of the Licensed Software with any software that
  is licensed under terms that seek to require that any of the Licensed Software
  … be provided in source code form".
- **§1 "Derivative Work"** includes work that "extends, replaces, emulates,
  substitutes for, or exposes to third parties the functionalities of the
  Licensed Software".
- **§3:** the open-source code ("Swamp OSS") "is not licensed under or subject
  to this Agreement".
- **§7.1:** Extensions are governed by their own terms, "not the terms and
  conditions of this Agreement".
- **§7.3:** "Customer is solely responsible for all Agent Operations"
  (automated workflows included).
- **§7.4:** use of a Third-Party Service "is governed solely by the terms and
  conditions of the applicable third party, and Customer is solely responsible
  for compliance therewith". This covers bpost.
- **§13.7:** comply with privacy law, including "the unlawful gathering or
  collecting … of information in violation of any privacy laws".

### Plans: Product Description and entitlement

- [Pricing](https://swamp-club.com/pricing): the Personal plan ($0) includes
  "Use in personal projects". Team costs $9 per user per month. "What counts
  as a user? Humans who use Swamp in the course of their job, either directly
  … or indirectly (by using an application, agent, chatbot, website, etc. that
  relies on Swamp)." Also: "What happens if I exceed my seat limit? … we'll
  reach out to you. We won't turn anything off." Enterprise lists an "AGPL
  exemption".
- [Subscription Commands](https://swamp-club.com/manual/reference/subscription-commands):
  "Personal License: free, for use outside of work. Work use needs a paid plan".
- `swamp auth whoami --json` on this machine shows the strongest plan as
  `personal`, and collective `zhann` is on Personal License. (The installed CLI does not have `swamp subscription` yet; the
  manual is ahead of the install.)
- [Swamp Account Requirement](https://swamp-club.com/manual/reference/swamp-account-requirement):
  "Every Swamp command needs a swamp-club.com account". This includes
  `swamp serve` and repos that use only a local datastore and vault. A login
  proof lasts 14 days, so the box can ride out short outages.

## Website terms, acceptable use and privacy

[Terms of Use](https://swamp-club.com/terms-of-use):

- **§5.2, prohibited use.** You may not "(e) engage in scraping, crawling, or
  similar automated data collection without Company's prior written consent".
  This is about **the Site** (swamp-club.com). The terms say nothing about what
  your workflows do to third parties. bpost is covered by SLA §7.4 instead.
- **§4.1:** "You may not create more than one Account per individual person…
  Accounts are personal and non-transferable." **§3.2:** "If You are using the
  Site on behalf of a company … You represent and warrant that You have the
  legal authority to bind that entity".
- **§6.3:** "You agree not to disable, circumvent, or interfere with Telemetry
  Data collection mechanisms". Note how §1 defines the terms:
  - "Telemetry Data" is data "necessary for the Licensed Software to operate",
    such as auth, registry queries and extension use.
  - "Usage Data" covers "commands executed, methods invoked on models,
    workflows run".

  The CLI's documented opt-out turns off usage telemetry, so on a plain reading
  it does not breach §6.3. The overlapping wording is untidy, though, and
  nothing reconciles the two definitions explicitly.
- **§21.9:** if you are a business, the Company may use "Your name, mark, and
  logo" in marketing "unless You notify Company otherwise in writing".
- [Privacy Policy](https://swamp-club.com/privacy-policy) collects "Telemetry and
  usage data … including the commands you run, the outcome of these commands,
  execution duration and timestamps, operating system, deno version, Swamp
  version, and the AI agent detected". Content you publish to the registry "may
  be accessible to other users".

## What the local CLI sends upstream

- **Usage telemetry is on by default.** `swamp config list` shows
  `telemetry.collection = enabled`. `.swamp.yaml` has no `telemetryDisabled`.
- **What is sent:** one event per command, plus one per workflow step. Events
  are POSTed to `https://telemetry.swamp-club.com/ingest`, with the stored API
  key in `x-api-key`, so they are attributed to the account
  ([Usage Telemetry Events](https://swamp-club.com/manual/reference/usage-telemetry-events)).
- **Names are sent; values are not.** Behavior, workflow and method names are
  sent as typed; `--input` values, paths, outputs and `data query` predicates
  are redacted
  ([About Usage Telemetry](https://swamp-club.com/manual/explanation/usage-telemetry)).
  For us, the workflow name `follow-parcel`, the behavior names and the method
  names (`snapshot`, `follow`) go up. Tracking codes, postcodes and the parcel data do not.
- **The GitHub README contradicts itself.**
  [L594-L598](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/README.md#L594-L598)
  says names are "sent as typed", but
  [L640-L643](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/README.md#L640-L643)
  says behavior names are `<REDACTED>`. The manual sides with "sent".
- **Opt-outs:** `swamp config set telemetry.collection disabled`,
  `telemetryDisabled: true` in `.swamp.yaml`, `SWAMP_NO_TELEMETRY=1`,
  `DO_NOT_TRACK=1`, or `--no-telemetry`
  ([README L662-L674](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/README.md#L662-L674)).
- **Not telemetry, but always sent:** the account check against swamp-club.com
  ([Account Requirement](https://swamp-club.com/manual/reference/swamp-account-requirement)).
  Registry calls for `extension search`, `pull` and `push` also go upstream.
  The datastore and vault stay local.

## Findings per scenario

### 1. The project as it is today

- **Explicitly allowed:**
  - Running the unmodified binary (AGPL §2).
  - A custom extension under our own terms, since it meets all four exception
    conditions.
  - A TUI that runs the CLI as a separate program.
- **Explicitly forbidden:** nothing the project does.
- **The plan:** a personal project on a Personal License, which covers it.
  Under SLA §2.1 plus the Product Description, work use would "need a paid
  plan", so it stays out of work.
- **Not addressed:** whether polling a third party every 30 s is acceptable.
  swamp leaves that to the third party's terms (SLA §7.4).

### 2. Option B: swamp on a personal box, APNs push, iOS Live Activity

- **Explicitly allowed:**
  - Running unmodified swamp on any machine (AGPL §2).
  - Adding APNs to `follow` in our own extension (exception §1-4).
  - Keeping the `.p8` key in a swamp vault (a documented feature).
- **Not a redistribution:** the iOS app does not ship swamp. It only talks to
  our box, so SLA §2.2(g), the OSS-FAQ distribution rules and the trademark
  rules on combined distributions do not come into play.
- **Users count:** the pricing FAQ counts people who use swamp "indirectly (by
  using an application … that relies on Swamp)". If the app is just you, that
  is one user.
  - The box, the parcels and the extension are personal, so the Personal
    License fits.
- **Telemetry from the box:** flushed on every command, attributed to the
  signed-in account. Names go up, tracking codes do not.
- **Not addressed by swamp:** Apple's APNs and Live Activity terms (not
  researched here).

### 3. Publishing `@zhann/bpost-parcel` (`swamp extension push`)

- **Explicitly allowed:** "license those extensions … under terms of your
  choice, free-open or proprietary"
  ([COPYING-EXCEPTION L9-L13](https://github.com/swamp-club/swamp/blob/f4852124e69ee4cc44e96f2e4afc6746ed1f4b29/COPYING-EXCEPTION#L9-L13)).
- **Required or committed by
  [Registry Terms](https://swamp-club.com/extension-registry-terms):**
  - **§3.4:** "Submitters are required to include an Extension License with each
    Extension". The manual says the registry does not *require* one
    ([About Extension Licenses](https://swamp-club.com/manual/explanation/extension-licenses)),
    but the Terms control. `manifest.yaml` declares `license: MIT` and ships a
    `LICENSE` file.
  - **§3.2:** you grant swamp "a nonexclusive, worldwide, royalty-free,
    perpetual and irrevocable license to … reproduce, modify, publicly perform,
    publicly display, distribute the Extension".
  - **§4.1(b):** you warrant the extension does "not infringe, misappropriate,
    or violate any third-party intellectual property rights, privacy rights, or
    applicable law".
  - **§4.3:** you indemnify swamp for claims arising from the extension.
  - **§9.2:** download counts, quality scores and the submitter handle are
    public.
- **Who is publishing:** the registry preamble and Terms of Use §3.2 have you
  represent authority to bind the organisation you publish for. `@zhann` is a
  personal collective, so this is a personal act.
- **Visibility:** public is the registry default
  ([Publishing reference](https://swamp-club.com/manual/reference/extensions/publishing)).
  `private` needs the collective's private entitlement. The extension is
  public.
- **Before any publish:** check that `fixtures/` really are scrubbed. The
  Privacy Policy says published content can be "copied and stored on third
  party systems where you might not have the ability to have it deleted".
- **Where the risk sits:** the §4.1(b) warranty ties publishing to bpost's
  terms. Publishing a client for an unauthenticated endpoint is the step that
  moves the bpost question from "our own use" to "we warranted it to swamp".

### 4. Wrapping swamp behind a small HTTP endpoint

- **AGPL: allowed.** Swamp is not modified, so §13 does not apply. The wrapper
  is a separate program that runs the CLI.
- **Exception's anti-substitute clause:** it applies to *extensions*. A wrapper
  that only starts `follow-parcel` is nowhere near "a practical substitute for
  Swamp".
- **SLA: not explicitly addressed, and the closest clauses lean against.**
  "Derivative Work" includes work that "exposes to third parties the
  functionalities of the Licensed Software". §2.2(e) forbids creating Derivative
  Works "without the prior written consent of Company", and §2.2(c) forbids
  "time-share".
  - An endpoint only your own phone calls is hard to read as exposing anything
    to third parties.
  - An endpoint other people call is close to the wording.
  - The terms define neither "third parties" nor "time-share" further.
- **Pricing:** everyone who uses the app counts as a user.
- **Trademarks:** offering it as a service to others under the swamp name runs
  into the OSS-FAQ (running "a software as a service" is a distribution) and the
  trademark policy.
- **Sanctioned alternative:** use `swamp serve`, which the SLA itself points to
  ("in a manner consistent with the Documentation").
  - It has a [`--webhook`](https://swamp-club.com/manual/reference/swamp-serve/webhooks)
    flag that "registers an HTTP endpoint that triggers a workflow when an
    incoming request arrives" (HMAC-signed, with a `generic` scheme).
  - It has a [REST API](https://swamp-club.com/manual/reference/swamp-serve/rest-api).
  - It has a documented flow for
    [linking an app to swamp serve](https://swamp-club.com/manual/explanation/linking-an-app-to-swamp-serve).
  - Using these instead of a home-made wrapper removes the Derivative Work
    question.

## bpost

The bpost tracking-site terms are researched separately in
[`docs/research/bpost-tos.md`](bpost-tos.md). SLA §7.4 and Registry Terms §4.1(b)
put compliance with them on us.

## Sources not reached or not found

- All swamp-club.com pages above loaded (HTTP 200, server-rendered).
- There is **no separate acceptable-use policy**. `/terms`,
  `/terms-of-service`, `/tos`, `/privacy`, `/acceptable-use`,
  `/acceptable-use-policy` and `/legal` all return 404. The sitemap's legal
  pages are the four documents cited, plus the cookie policy and the
  subprocessor list, neither of which bears on these questions.
- The SLA and the OSS-FAQ point at `git.swamp-club.com/swamp-club` for the
  source. This note cites the GitHub repo, pinned to `f4852124`, and does not
  check that the two match.
- The SLA does not say exactly which "Product Description" binds a given
  account. This note treats the pricing page and the plan shown by
  `swamp auth whoami` as that description.
