# Good / better / best: one implementation

**Status (10/31): DONE — made one.** Still registered **not ready** (hidden) until it is tested for real.

Field service PR #169 (`quote_options`: a line had an option *name*, `quote_line_item.option_group`) and roofing PR #170
(`quote_proposals`: an option is a *row*, `quote_proposal_option`, with a brand, warranty, photos, recommended, chosen) were
built in parallel. They are now one, on roofing's model — what Roofr, Housecall Pro and ServiceTitan sell.

What it is now:

- **One feature, `quote_proposals` ("Good / Better / Best")**, offered to every trade with quotes: contractor, field service,
  basic, landscaping, roofing (packages/tenant-backend `featureRegistry.ts`). `quote_options` is gone.
- **One server** (packages/tenant-backend `invoicing/quoteOptions.ts`, `quotes.ts` `/:id/proposal`, `/:id/proposal/choose`,
  `/:id/proposal/from-pricebook`), **one customer handler** (`portal.ts` `choose-option`, `{ optionId }` only).
- Carried over from field service onto it:
  - the **deposit follows the option chosen** — each option shows its own deposit to the customer, and the deposit invoice is
    the chosen option's;
  - **a deposit bigger than the cheapest option is refused**, whether the deposit or the options are saved last;
  - the refusal to sign or approve before a choice carries `code: 'option_required'`;
  - the **office picks for a customer who says it by phone** (desktop panel and now the phone's quote screen);
  - the **quote PDF before a choice** prints the lines every option shares and each option with its lines, brand, warranty,
    deposit and whole price, and the total as "from" the cheapest. (Both PDFs also stopped printing an optional line nobody
    ticked: the customer's printed every line.)
- Roofing's job value follows the choice (`apps/unified/server/crm/roof/proposalValue.ts`), unchanged.
- **Migration 0050** turns any named option lines into proposal option rows (chosen where picked), then drops `option_group`.
- **Tests:** `apps/unified/tests/quote-options.test.ts` (field service, basic, contractor, landscaping),
  `roof-gbb-proposals.test.ts` (roofing), `migration-0050-quote-options.test.ts` (the conversion).
  `quote-options-one-before-ready.test.ts` is deleted.

## Sets (10/31, `cloud/fieldservice-parity` item 9 — `fieldservice-quote-options.md` rows 5 and 6)

- **Up to three sets on one quote** (Jobber: up to 3 sets, 2–5 choices each; ours 2–6). `quote_proposal_option` gained
  `set_index` (0–2), `set_name` (what the customer sees; null on a quote's only set = "Options") and `set_kind`:
  `'one'` — the customer picks exactly one of the set — or `'any'` — **additive** (HCP "approve more than one option",
  ServiceTitan additive): any number, none included, each shown at what it adds. Migration 0055 (hand-written on the
  branch; the integrator regenerates it).
- **One server, still:** `PUT /:id/proposal { sets: [{ name, kind, options }] }` (`{ options }` alone is still the one
  unnamed pick-one set, so nothing written before changes); `POST /:id/proposal/choose` and the customer's `choose-option`
  take `{ optionId, chosen }` — a pick-one pick can only move, an add-on is ticked and unticked on its own. More than one
  set must be named. `from-pricebook` builds one set named after the item.
- **The price of an option** is the whole quote with it and what is picked in the other sets (`takenWith`); `addPrice` is
  what it adds. **The deposit's limit** is the cheapest pick of every pick-one set with no add-on (`lowestPrice`); the
  quote's total "from" that in the email and the PDF while a pick-one set is unpicked.
- **Signing** refuses (`option_required`) until every pick-one set is picked; add-ons never block. The fingerprint and the
  audit row name every pick ("Better + Smart + Air purifier"); the invoice and the job carry every pick's lines; roofing's
  job value follows a quote with options whether or not an add-on was taken.
- **The PDF** prints each set under its name ("choose one" / "add any you want"), a chosen option marked, and keeps offering
  the add-ons until the quote is signed. **The email** lists each option under its set.
- **Screens:** the desktop panel (sets, kind, add / remove for the customer, the editor with up to three sets), the
  customer's page (sets laid out, add-ons toggled), the phone's quote screen (sets, Choose / Add / Remove, each asks first).
- **Tests:** `apps/unified/tests/quote-option-sets.test.ts` (field service and basic — fails without the change),
  `tests/mobile/quote-option-sets.test.ts`; the single-set tests above still pass unchanged.

Before switching it on: build options on a real quote in the browser, send it, pick and sign on a phone, pay the deposit in
Stripe test mode, and print the PDF. Sets and add-ons are not seen in a real browser or on a real phone yet.
