# Consumer financing (Wisetack) — what finishing it would need

Not built in this PR (owner decision). Consumer Financing (`consumer_financing`, NOT READY) already exists in
`apps/unified/server/crm/financing/` — the screens, the routes, the disclosure text and the status handling are written.
What it has never done is meet the real lender, because the lender's partner API is not public
(`lender.ts` says so at the top: everything marked `SPEC-PENDING` is this app's own guess at that contract).
To finish it, in order:

1. **A signed integration partnership with Wisetack** (wisetack.com/partnerships). It gives us the partner API reference and a
   sandbox. Nothing below can be started honestly without it.
2. **The real contract replaces the `SPEC-PENDING` parts in `lender.ts`:** the API address and authentication, the request that
   opens an application, the response, the webhook body, and the webhook signature header and scheme (today an HMAC-SHA256 guess).
3. **How a business connects its own Wisetack merchant account** (the credentials or link it gets in Wisetack's merchant portal),
   stored per business, never shared across businesses.
4. **Tests against the lender's sandbox, not a mock of our own guess** — run by a person with the sandbox keys; they cannot be
   run from a test in this repo (no test may call a live API).
5. **Wisetack's compliance sign-off.** Any wording about a monthly payment, APR or term must be their toolkit's text or approved by
   them (`DISCLOSURE` is the toolkit's text, word for word); every screen that shows such wording needs checking against it.
6. **Owner decisions:** whether to offer it on the phone (the brief says no card-taking on the phone — financing only opens
   the lender's own page), which verticals, and who explains it to customers.

**Money:** Wisetack pays the business by ACH the next business day after the customer confirms. Nothing moves on our account.
