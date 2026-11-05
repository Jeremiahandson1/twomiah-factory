# Parity: customer financing (Wisetack) — field service and basic

Branch `cloud/fieldservice-parity`, item 11. Feature id `consumer_financing` (NOT READY, `hidden` in `featureRegistry.ts`; now offered to
`crm-fieldservice` and `crm-basic` as well as the trades it already had). Server: `apps/unified/server/crm/financing/` (`lender.ts` is the
one adapter, `service.ts`, `routes.ts`, `sandbox.ts`). Screens: `web/src/crm/financing.tsx` (the Financing page, the panel on a quote or
invoice, the connection card under Settings › Integrations), `financingOffer.tsx` (the customer's page), the website calculator
(`site/views/sections/financing/calculator.ejs`), and the phone (`apps/mobile/src/payments/financing.ts`).
Tests: `tests/financing.test.ts`, `tests/financing-parity.test.ts` (both verticals), `tests/mobile/financing-phone.test.ts`.

**Leader reviewed:** Jobber and Housecall Pro both build in Wisetack (wisetack.com lists them as software partners). Wisetack's own
public pages (merchant FAQ, merchant-portal statuses, marketing-toolkit compliance) are what this was written from. Its partner API is
published only to signed partners.

**What cannot be built without Wisetack, and is therefore NOT claimed:** the partner API itself. Its address, authentication, the request
that opens an application, the response, the webhook body and the webhook signature header and scheme are this app's own guess. They are
marked `SPEC-PENDING` and live in ONE place — the `wisetack` adapter at the bottom of `lender.ts`. `tests/financing-parity.test.ts` reads
`service.ts` and `routes.ts` and fails if any of that leaks out of the adapter. **Nothing here has met the real lender.** That is why the
feature stays `hidden`: no plan, signup or switch gives it to a business until the owner steps below are done.

| # | Leader (from its pages) | Ours | Mark |
|---|---|---|---|
| 1 | Quote and invoice show "as low as $X/mo" and an Apply button | Both, with the lender's own example terms on the amount, in its $500–$65,000 range; none outside it, with the reason in words | matches (estimate is the lender's example terms, not the customer's real offer — as theirs) |
| 2 | Customer applies on the lender's page after a soft check | The customer's quote/invoice page and the office's text or email send them there; the office can also open it | matches |
| 3 | Status comes back from the lender; the loan shows as paid on the invoice | Signed webhooks move the application once (a repeat or late event changes nothing) and record the money once as a "financing" payment on the invoice; a funded quote with no invoice yet waits and is recorded once the invoice exists | built, **unverified against the real webhook** (SPEC-PENDING) |
| 4 | Each business uses its own merchant account | Merchant ID and prequalification link are kept per business on its own company row, validated (https, Wisetack's domain), never in the server's environment. Twomiah's partner credentials are the server's (one partnership) | matches |
| 5 | Wisetack's compliance: any monthly payment, APR or term needs its full disclosure, verbatim or approved | `DISCLOSURE` is the marketing toolkit's text, pinned word for word by a test. It is shown with the payment on the office panel, the customer's page, the email (HTML and text) and now **the website calculator** (which showed a payment and an APR without it before: it now shows nothing at all without the disclosure). A test reads every screen/file that shows a payment, APR or term for financing and fails if it lacks the disclosure | matches; **Wisetack's own sign-off is still the owner's** (step 5 below) |
| 6 | Phone | The phone offers "Offer customer financing" on a quote or invoice (seat with `financing:create`, switch on, document open). It asks the server for the application and **only opens the lender's page** — no payment, APR or term is shown, no card is taken, nothing is recorded on the phone | matches the brief ("phone only opens the lender's page"); **not seen on a real phone** |
| 7 | basic vertical | Registered for `crm-basic`; tested on field service and basic through the real server | matches |
| 8 | Sandbox | `bun apps/unified/scripts/financing-sandbox.ts` runs the adapter against Wisetack's sandbox **only with keys a person supplies** (`WISETACK_SANDBOX_URL`, `_KEY`, `_MERCHANT_ID`, `_CONFIRM=sandbox`, and optionally a saved webhook sample). It never reads the production names, calls nothing without the keys, and says which guess to fix in `lender.ts`. No test in the repo calls a live API (the fetcher is injected) | built; **never run** — it needs the owner's keys |
| 9 | Money | Wisetack pays the business by ACH the next business day after the customer confirms. Nothing moves on our account | as theirs |

**Parity verdict:** everything that can be built without Wisetack's partner documentation is built and tested on both verticals. It is
**not at full parity**, and cannot be shown to be, until the real contract replaces the guesses: rows 3 and 8 are unproven against the
lender.

## Owner steps (in order)

1. **Sign the integration partnership with Wisetack** (wisetack.com/partnerships). It gives the partner API reference and a sandbox.
2. **Give the sandbox keys to whoever runs the harness** and run `bun apps/unified/scripts/financing-sandbox.ts` (set the variables listed
   in `sandbox.ts`); save one webhook the sandbox sends as `{ signature, body }` to check the signature and event body too.
3. **Fix `lender.ts` where the report says a guess was wrong** (API address and authentication, the request/response, the webhook header,
   signature scheme and body), run the harness again until it confirms every check, then set `WISETACK_API_URL`, `WISETACK_API_KEY` and
   `WISETACK_WEBHOOK_SECRET` on the server.
4. **Each business connects its own Wisetack merchant account** (Settings › Integrations: merchant ID and prequalification link from
   Wisetack's merchant portal, Account settings › Merchant information).
5. **Wisetack's compliance sign-off.** Send support@wisetack.com the screens that show a payment (office panel, customer page, email, website
   calculator) for approval, or confirm they use the toolkit text unchanged.
6. **Decide** which businesses are offered it and who explains it to customers, then remove `hidden` from `consumer_financing` in
   `featureRegistry.ts` (and the not-ready tests' list) when 1–5 are done.
7. **Look at it on a real phone and in a real browser** — neither has been done.
