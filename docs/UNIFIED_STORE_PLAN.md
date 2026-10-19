# The store into the unified app — the plan

The store is two templates: the back office `templates/crm-store` (catalogue, orders, refunds, payments, shipping,
suppliers, loyalty, discounts, reviews) and the storefront `templates/website-store` (a fork of the older
`website-contractor` site with shop, product, cart and checkout pages). Today they are two services per tenant, the
storefront calling the back office's public API over HTTP. Measured on branch `engine`, 2026-10-19.

## What it is

| | Store | For comparison |
|---|---|---|
| Back office | 8,900 lines: 26 route files (orders 933, public storefront API 666, payments 294 …), payment adapters for Stripe / Square / PayPal, EasyPost shipping, Printful / CJ suppliers | roofing ~9,400 |
| Back-office screens | 4,400 lines, 21 pages | roofing ~18,500 |
| Storefront | 728-line server, 19 views, `cart.js` (556), and a 3,160-line JSON-file CMS copied from `templates/cms`; no database, no shopper logins | |
| Tables | 23, one business per database: **no `company_id` on any** (as home care was), uuid ids, `timestamptz`, `jsonb`, money in integer cents, tax in basis points | |
| The business | `store_settings` (one row) | `company` |
| People who sign in | `users` (`name`; roles owner / manager / staff, staff = the shared `field` rung) | `user` |
| Customers | none: the Customers page is derived from orders by email; loyalty members are keyed by email | `contact` |
| Shared with the unified schema by name | `loyalty_members`, `loyalty_transactions`, `loyalty_rewards` (the unified loyalty is keyed by contact), `email_alias`, `inbound_message`, `gbp_connection`, `audit_log`, `mfa_*` | |
| Permissions | the shared matrix already (`createPermissions`, staff → field) | |
| Feature switches | none: everything is core | |
| Background work | 7 timers: stale pending orders, abandoned carts, review requests, supplier forwarding, pending refunds, webhook set-up, subscription pull | |
| Its own suite | `tests/store`, 19 files, ~3,700 lines; plus 4 storefront tests in `tests/shared` | |

## Decisions (each follows the rulebook, and the home-care and roofing moves)

1. **One business table, one people table (RULEBOOK §4).** `store_settings`' business fields (name, support email,
   onboarding, subscription) are the `company` row's; its commerce settings (flat shipping, tax rate and zones,
   storefront origin, abandoned-cart and review-request switches, loyalty's points rule) stay the store's own settings
   row, with `company_id`. `users` becomes `user`: `name` split into first and last at cutover, ids kept.
2. **A shopper is a customer — a `contact` (the roofing rule: one customer list).** Checkout finds the contact by
   email or makes one, and the order carries `contact_id`; the Customers page is the CRM's contacts, so a shopper's
   orders, texts, emails and reviews sit on one record, and every engine fix reaches them. **Loyalty is the engine's**
   (keyed by contact, as salon, bar and restaurant already use it): an order earns and redeems the way a paid check
   does, with `order_id` beside `check_id` and the store's minimum-spend on a reward added — one loyalty, not two.
3. **The store's own tables are its add-on (`server/crm/store/`, `web/src/crm/pages/store/`).** Products, images,
   variants, orders, order items, refunds, discount codes, product reviews, payment, shipping and supplier settings,
   the variant ↔ supplier map. Names keep their spelling (RULEBOOK §2: plural stays plural, so rows move unchanged);
   each top-level table gains `company_id`; ids are text (the uuids move across as text); `json`, `timestamp`; money
   stays integer cents in columns named `*_cents`, as the store already keeps it.
4. **The storefront is the unified website.** Home, about, contact, blog and pages are the site's own (sections,
   designs, the admin); the shop, product, cart, checkout and order-received pages, the cart script and the
   store-closed page are the store's site add-on, served by the same app, so the storefront's calls are same-origin —
   no second service, no open CORS, no proxy. The JSON-file CMS and its separate admin login are not moved.
5. **Payments stay the merchant's own** (their Stripe, Square or PayPal account, its keys encrypted, its webhooks
   verified), the store's adapters moved as they are; checkout still prices every line on the server.
6. **The shared modules are the engine's** (sign-in, MFA, team, company, audit, email aliases and domain, Google
   Business, inbound mail, billing, platform support, domain purchase, media); each store copy is diffed the
   near-copy way — a store difference becomes a switch, a fix only the store has goes to the engine for everyone.
7. **Timers** run in the app's one scheduler, each guarded so one tenant's server runs each sweep once.

## Order of work

1. Schema: the store's tables (add-on), contact link on orders, loyalty's `order_id` / minimum spend; one migration,
   read before it is kept.
2. The vertical `store` (`verticals/store/settings.ts`, the id industryRouting already uses), and the suite harness.
3. Server, in groups: catalogue (products, variants, images, media); checkout and orders (public API, payments,
   webhooks, refunds, the order sweeps); fulfilment (shipping, suppliers); marketing (discounts, reviews, abandoned
   carts, loyalty onto the engine's); settings and the shared modules' diff.
4. Screens: the back office's pages; the storefront's shop pages as the site's store add-on.
5. The suite: `tests/store` on the unified app as `store`, every file passing or a documented divergence; then the
   browser, every seat, both themes, phone and desktop, and a real checkout against each provider's sandbox.
6. Cutover data steps recorded in `docs/CUTOVER_LEDGER.md` as each lands.
