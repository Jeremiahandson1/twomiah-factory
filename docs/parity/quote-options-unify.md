# Good / better / best: two implementations, to be made one

**Status (10/30 integration):** two implementations of the same feature were built in parallel and are merged side by side.
Both are registered **not ready** (hidden), and `apps/unified/tests/quote-options-one-before-ready.test.ts` fails if either is
un-hidden while both exist. Make them one before switching either on.

| | Field service PR #169 — `quote_options` | Roofing PR #170 — `quote_proposals` |
|---|---|---|
| Model | a line has an option **name** (`quote_line_item.option_group`); options are the distinct names | an option is a **row** (`quote_proposal_option`: name, tier, brand, warranty, description, photos, recommended, chosen) and a line points at it (`proposal_option_id`) |
| Limits | 2–5 options | 2–6 options |
| Office | option name column in the line editor; office can pick by phone | options built on the quote; per-option lines kept out of the shared edit form |
| Customer | pick by name (`{ group }`); deposit follows the pick | pick by id (`{ optionId }`); job value follows the pick (`roof/proposalValue.ts`) |
| Customer address | `POST …/quotes/:id/choose-option` — the same address; `portal.ts pickOption` sends a request to the right one by what it carries | |

## The target

One implementation on **roofing's model** (a real option row: brand, warranty, photos, recommended, its own price) — it is what
Roofr, Housecall Pro and ServiceTitan sell. Carry over field service's extras onto it:

- the deposit follows the chosen option (field service), and the job value follows it (roofing) — both;
- the office can pick for the customer by phone;
- the quote PDF before a pick prints the shared lines and the options side by side;
- the phone's quote form gets an option picker (field service noted it had none).

Then: migrate any `option_group` lines into `quote_proposal_option` rows (both features are hidden, so no live quote holds either;
still write the migration), drop `option_group`, one feature id (`quote_proposals` or a new shared one) offered to every trade with
quotes, one portal handler, one set of tests (`quote-options.test.ts` and `roof-gbb-proposals.test.ts` merged), and delete
`quote-options-one-before-ready.test.ts`.
