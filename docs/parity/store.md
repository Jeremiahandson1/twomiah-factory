# Store (e-commerce) parity — Shopify

**Status (10/31).** The research was done before 10/30 from help.shopify.com and Stripe's docs (the checklist in the 10/30
follow-up to the cloud session); PR #174 built against it and is live since 10/31 (main f855f4d65). New features stay hidden
until tested: `store_sales_reports`, `store_low_stock`, `store_ai_writer`, `store_accounts`, `store_returns`; Email Marketing,
Review Requests and QuickBooks are offered to the store as opt-in. Marks: **built** · **partly** · **not built** · **beats**.
Checked against the code on 10/31 where the PR report did not say.

| # | Shopify feature | Twomiah | Mark |
|---|---|---|---|
| Payments | Apple Pay, Google Pay, Link | no code needed: Stripe's hosted Checkout shows them when on in the merchant's Stripe settings | built |
| 1 | Date-range filter; sales over time by day / week / month | `?from&to&bucket`, on the shop's clock, net of refunds | built |
| 1 | Sales by product | top products | built |
| 1 | Sales by **variant** | by product only | not built |
| 1 | Profit / margin from stored cost | from each product's cost at the time of sale ("no cost" shown, never zero) | built |
| 1 | Sales by discount code | orders, amount off, what those orders kept | built |
| 1 | Top customers; returning vs new; average order value | repeat customers and average order | built |
| 1 | CSV export | sales by day, products, codes | built |
| 3 | Segments from CRM data: groups, tags, last order date | tag, customer group, "no order in N days" | built |
| 3 | Segments by total spend, by product / category bought | not found | not built |
| 3 | Campaign editor + send to a segment | shared Email Marketing | built |
| 3 | Welcome series; win-back after N days (owner sets N) | both, off by default; every trade with Email Marketing gets them | built |
| 3 | Post-purchase automation | a delivered order asks for a review (Review Requests); no other post-purchase email | partly |
| 3 | Unmetered sends at our price | Shopify charges after 10,000 a month | beats |
| 4 | Per-variant low-stock level, "Low stock" filter, dashboard count | built | built |
| 4 | One daily digest email (not per sale) | built — Shopify needs a Flow for this | beats |
| 4 | "Draft a reorder" for the supplier | not found (suppliers route orders; no reorder draft) | not built |
| 5 | AI description from title / attributes / notes, tone choice, SEO description, image alt text, owner reviews before saving, AI-off rule | built, 30 requests an hour per shop | built |
| 6 | QuickBooks: sales receipt per paid order, refund receipts, Stripe fees so payouts reconcile, retries and a sync log | built — Intuit's own Shopify app is rated 2.1/5 | beats |
| 7 | Sign-in by emailed one-time code (no passwords), long sessions | link or 6-digit code; 30-day session; any shopper can make an account | built |
| 7 | Order history and status, saved addresses that fill checkout, reorder | built | built |
| 7 | Wholesale group prices at online checkout when signed in (Shopify Basic now has B2B) | built (shown in the cart, charged at checkout; not on listings) | built (parity, not a selling point) |
| 7 | Loyalty points and gift-card balance on the account page | store credit shows when returns are on; loyalty points not shown | partly |
| 8 | Return statuses: requested → approved → label sent → received → closed | requested → approved / declined → received → refunded / exchanged (no separate "label sent") | built |
| 8 | Return window; restocking and return-shipping fees | from the ship date; both fees; waived for shop-fault reasons | built |
| 8 | EasyPost return label, or upload your own | prepaid EasyPost label when the shop turns labels on | built |
| 8 | Refund to card and / or store credit; staff exchanges; shopper-started returns | built | built |
| — | Shop Pay's network, Shopify Audiences, the app store | — | can't match (not attempted) |

## What is left
1. Sales by variant.
2. Segments by total spend and by product / category bought; a post-purchase email beyond the review request.
3. "Draft a reorder" for the supplier from the low-stock digest.
4. Loyalty points on the shopper's account page.
