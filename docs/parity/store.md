# Store (e-commerce) parity — Shopify

**Status (10/31, after the parity round on `cloud/store-parity`).** The research was done before 10/30 from help.shopify.com
and Stripe's docs (the checklist in the 10/30 follow-up to the cloud session); PR #174 built against it and is live since 10/31
(main f855f4d65). New features stay hidden until tested: `store_sales_reports`, `store_low_stock`, `store_ai_writer`,
`store_accounts`, `store_returns`, and from the parity round `store_segments`, `store_followups`, `store_reorders`,
`store_fast_checkout`, `store_audiences`, `store_apps`, `store_api`, `store_webhooks`; Email Marketing, Review Requests and
QuickBooks are offered to the store as opt-in. Marks: **built** · **partly** · **not built** · **beats** · **outside party**
(only the other company can do it). Nothing from the parity round has been seen in a real browser or on a real phone.

| # | Shopify feature | Twomiah | Mark |
|---|---|---|---|
| Payments | Apple Pay, Google Pay, Link | no code needed: Stripe's hosted Checkout shows them when on in the merchant's Stripe settings | built |
| 6 | The same buttons on the product and cart pages (accelerated checkout) | `store_fast_checkout`: server quote → PaymentIntent for exactly that total, wallet address and shipping choice, order finished by the success page. Stripe.js, Apple Pay, Google Pay and Link have not been run in a browser. Apple Pay needs the shop's domain registered with Stripe — the owner's step | built (unseen) |
| 6 | Saved card with consent; one-tap pay at checkout and "reorder and pay" from order history | the card is kept on the shop's **own** Stripe customer only after the shopper ticks the box; one tap charges it, to the saved address only; removable any time (detaches at Stripe). Stores using Stripe Tax: the card is kept but the app's own one-tap is off | built (unseen) |
| 6 | Shop Pay's network of shoppers across all Shopify stores | Shopify's own network | outside party |
| 1 | Date-range filter; sales over time by day / week / month | `?from&to&bucket`, on the shop's clock, net of refunds | built |
| 1 | Sales by product | top products | built |
| 1 | Sales by **variant** | units, net sales, cost, profit and margin per option (size / colour), on the shop's days, net of returned units; CSV; cost hidden from a seat that does not see costs | built |
| 1 | Profit / margin from stored cost | from each product's cost at the time of sale ("no cost" shown, never zero) | built |
| 1 | Sales by discount code | orders, amount off, what those orders kept | built |
| 1 | Top customers; returning vs new; average order value | repeat customers and average order | built |
| 1 | CSV export | sales by day, products, codes | built |
| 3 | Segments from CRM data: groups, tags, last order date | tag, customer group, "no order in N days" | built |
| 3 | Segments by total spend, order count, product / category bought and **not** bought | `store_segments`: saved segments over the last N days or a stretch of the shop's own days; one query shared by campaigns, the post-purchase emails and the audience export | built |
| 3 | Segments usable by campaigns and automations | campaigns (audience picker), the three post-purchase emails, and the shared **welcome** and **win-back** automations can each be limited to a saved segment (the same query; a segment that is gone matches nobody; a segment an email sends to cannot be deleted) | built |
| 3 | Campaign editor + send to a segment | shared Email Marketing | built |
| 3 | Welcome series; win-back after N days (owner sets N) | both, off by default; every trade with Email Marketing gets them | built |
| 3 | Post-purchase automation | `store_followups`, off by default: first-order follow-up, thank-you with the products bought / cross-sell, replenishment reminder (owner sets the days); sent once per order through the shared claim, so unsubscribe and Email Marketing gating are honoured; plus the review request | built |
| 3 | Unmetered sends at our price | Shopify charges after 10,000 a month | beats |
| 4 | Per-variant low-stock level, "Low stock" filter, dashboard count | built | built |
| 4 | One daily digest email (not per sale) | built — Shopify needs a Flow for this | beats |
| 4 | "Draft a reorder" for the supplier | `store_reorders`: one purchase order per supplier from the low-stock list, quantities net of open orders, the supplier's cost, the owner edits and emails it, received stock books in against it. Phone: a Deliveries screen books a whole delivery into stock (online only — receiving is not safe to queue) | built |
| 5 | AI description from title / attributes / notes, tone choice, SEO description, image alt text, owner reviews before saving, AI-off rule | built, 30 requests an hour per shop | built |
| 6 | QuickBooks: sales receipt per paid order, refund receipts, Stripe fees so payouts reconcile, retries and a sync log | built — Intuit's own Shopify app is rated 2.1/5 | beats |
| 7 | Sign-in by emailed one-time code (no passwords), long sessions | link or 6-digit code; 30-day session; any shopper can make an account | built |
| 7 | Order history and status, saved addresses that fill checkout, reorder | built | built |
| 7 | Wholesale group prices at online checkout when signed in (Shopify Basic now has B2B) | built (shown in the cart, charged at checkout; not on listings) | built (parity, not a selling point) |
| 7 | Gift-card balance on the account page | every card the shopper bought or was given, with balance and code; a spent card reads "used up"; void cards and store credit left out | built |
| 7 | Loyalty points on the account page | shown as "reward points" for a loyalty member (this note said they were not; the code and a new test say they are) | built |
| 8 | Return statuses: requested → approved → label sent → received → closed | requested → approved / declined → received → refunded / exchanged (no separate "label sent") | built |
| 8 | Return window; restocking and return-shipping fees | from the ship date; both fees; waived for shop-fault reasons | built |
| 8 | EasyPost return label, or upload your own | prepaid EasyPost label when the shop turns labels on | built |
| 8 | Refund to card and / or store credit; staff exchanges; shopper-started returns | built | built |
| 7 | Customer audiences: hashed export in Meta Custom Audiences and Google Customer Match formats | `store_audiences`: values normalised as each platform documents, SHA-256, unsubscribed customers and people with no email or phone left out and counted; audited | built |
| 7 | Push an audience straight to Meta / Google Ads | Meta Marketing API and Google Ads API (developer token + OAuth), written to the documented requests and tested against a stand-in only. Needs the owner's Meta System User token (App Review if the app is not theirs) and Google's developer-token approval; Customer Match consent fields (EEA) are not sent | built to the platform's approval step |
| 7 | Purchase events: Meta pixel + Conversions API, Google tag via Tag Manager | a `purchase` dataLayer event and pixel Purchase on the order-received page; the same purchase from the server to the Conversions API, de-duplicated by order number, skipped for an unsubscribed customer | built (unseen) |
| 7 | Shopify Audiences (the pool of shoppers across Shopify stores) | Shopify's own cross-merchant data | outside party |
| 8 | Apps & integrations page: connect state and settings | `store_apps`: Payments, Shipping (EasyPost), Dropship supplier, QuickBooks, Email Marketing, Review Requests, Google and Meta ads, Store API, Webhooks — each with state, settings in words, and where to change it | built |
| 8 | Public store API with per-shop keys and scopes | `store_api`: `/api/store/v1` products, orders, customers, inventory (read) and stock counts (write); five scopes; key shown once, only its hash kept; revocable; 120 a minute per key; cursor paging; nothing about costs, notes or suppliers | built |
| 8 | Outgoing signed webhooks with retries and a delivery log | `store_webhooks`: order created / paid / fulfilled / refunded, product and stock changed; timestamped HMAC signature; public https only (checked on save and before every send); retries after 1 min, 5 min, 30 min, 2 h, 6 h; log with "Send again" and "Send a test" | built |
| 8 | A catalogue of apps made by other companies (the App Store) | needs those developers, a review of their apps and a listing; a developer can build against the Store API and webhooks | outside party |

## What is left
Only an outside party, an approval or a real-device look remains; nothing in the eight rows was left unbuilt or partly built.
1. **Outside party, not built:** Shop Pay's network across stores; Shopify Audiences' pool of shoppers; other companies' apps in a catalogue.
2. **Owner's approvals before these work live:** Apple Pay domain registration with Stripe; the Stripe Connect webhook subscribed to `payment_intent.succeeded` (wallet payments); a Meta System User token with `ads_management` (App Review if the app is not theirs); Google's developer-token approval and an OAuth client for Customer Match.
3. **Never run against the real thing:** Stripe.js and the wallets, Meta's and Google's APIs (tested against stand-ins), any webhook receiver. No page was seen in a real browser and no phone screen on a real phone.
4. **Is the trade at full parity with Shopify?** Not yet: what a single shop can do is built, behind hidden switches, but the three outside-party items above are Shopify's own network and marketplace, and the unseen items must be tried live before any switch is turned on.

## Shopify's plan chart (11/10)

The owner's paste of Shopify's "Compare features across plans" (Basic / Grow / Advanced / Plus), checked against our code on
11/10. Most rows are built (above). What is not:

| Shopify | Ours (code, 11/10) | Mark | Builds on (share first) |
|---|---|---|---|
| **In-person payments (POS)**: a customer's credit or debit card taken at the counter — card reader or tap to pay | half built 11/10, hidden (`store_counter`): Store › Sell at the counter — type or scan products (a USB scanner adds the exact SKU / barcode), the store's tax, paid by cash or the shop's own card machine, handed over, stock off, receipt by email (`crm/store/orders/counterSales.ts`, `tests/parity-store-counter.test.ts`). **Not built: taking the card in the app** (Tap to Pay / a reader on the store's own Stripe — a new card-present money integration, needs a real device; parked for the owner) | partly (hidden) |
| **SMS campaigns; chat with customers** | Two-Way Texting is not offered to the store | not built | **shared** `two_way_texting` (on 12 CRMs) — open it to the store; campaigns ride Email Marketing's audiences |
| **Inventory locations** (10 on every plan, 200 on Plus) | built 11/10, hidden (`store_locations`): Store › Stock by location — locations (the shared inventory's), a count per location, moving stock between them; the storefront sells against the total, a sale takes from the first location first (`server/data/storeStock.ts`, `tests/parity-store-locations.test.ts`). Added 11/11: an order is filled from one location — the first with every line, or the counter's own for a counter sale — changeable on the order until it is sent (exactly its units move back and come off the new one); a refund restocks there | yes (hidden) |
| **Carrier rates at checkout** ("3rd-party calculated shipping rates", Advanced and Plus) | built 11/10, hidden (`store_carrier_rates`): the cart asks for a ZIP and shows the store's own carrier account's live rates for the cart's weight (EasyPost, the store's key), cheapest first; the order asks the carrier again and prices the one picked — never a browser price; the free-shipping threshold still applies; no ZIP / no carrier / carrier failing: the store's own rate (`checkout/carrierRates.ts`, `tests/parity-carrier-rates.test.ts`). Known: the payment page's full address may differ from the ZIP quoted | yes (hidden) |
| **Sell globally**: prices in local currencies, translated storefront, duties | one currency per shop, English | not built | — (only for shops selling abroad) |
| **Marketplace orders** (Amazon, eBay, Etsy imported) | none; Google and Meta product feeds exist (`checkout/feeds.ts`) | not built | each marketplace's seller approval — outside party first |
| 200+ reports | the core reports (row 1 above): sales over time, by product, variant, discount code, profit, repeat customers, CSV; built 11/10, hidden (`store_report_schedules`): any of them saved by period name and emailed as a CSV weekly or monthly, on the shared saved-reports machinery (`crm/store/orders/savedSalesReports.ts`, `tests/parity-store-report-schedules.test.ts`); added 11/11: sales by customer, by channel, by place, taxes by month, refunds given and inventory value (cost columns only for a seat that sees costs) — on Store › Sales, as spreadsheets, and saved like the rest. Shopify's long tail (by staff, ABC analysis, sell-through…) is not built | partly |
| Shopify Balance, Capital, Credit card, Bill Pay; Shop Pay network; Collective; Shopify Audiences | — | outside party | Shopify's own banking and network |

Where we are ahead on the chart: no platform fee on the shop's payments (the store's code adds no application fee — the shop
pays Stripe's own rate; Shopify adds 2% on Basic without Shopify Payments), unmetered email, staff logins on every plan (Basic has
none), unlimited wholesale groups (Shopify: 3 catalogs below Plus), and the QuickBooks books (row 6).

### What is left (11/10), shared first
1. In-person payments (credit / debit cards at the counter) — open `tap_to_pay` to the store, add the counter screen.
2. SMS and customer chat — open `two_way_texting` to the store.
3. Inventory locations — store variants on the shared inventory locations.
4. Carrier rates at checkout — EasyPost `getRates` at checkout.
5. Reports — the store's sales on the shared report builder.
6. Selling abroad (currencies, translation, duties) and marketplaces — only if the owner targets those shops.
