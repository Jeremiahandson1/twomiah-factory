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

Before switching it on: build options on a real quote in the browser, send it, pick and sign on a phone, pay the deposit in
Stripe test mode, and print the PDF.
