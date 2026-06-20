# Integration wire-up checklist — Financing (Octane) + Trade Valuation (J.D. Power / Black Book) + Reserve deposits (Stripe)

Everything below is already coded behind a stable adapter interface. Going live = (1) open the account, (2) drop the credentials into the per-company config, (3) confirm the one marked API call against the provider's docs, (4) (optional) wire the website form to show the live number instead of just capturing a lead.

Per-company config lives in the CRM company record's `integrations` JSON (Settings → Integrations). Adapters read it on each call.

---

## 1. Octane / Roadrunner Financial — financing prequalification (primary)

**Account:** Enroll as an Octane dealer (octane.co / Roadrunner). Ask specifically for **dealer API access / prequalification API** credentials, and whether they provide a **hosted prequal widget (embed/iframe)** or a **REST API** — many powersports lenders ship a widget. (If widget: we embed it on the unit page; if REST: the adapter below calls it.)

**They issue:** API Key, Dealer ID (and a sandbox/test key).

**Where the key goes** — `company.integrations.financing.octane`:
```json
{ "enabled": true, "apiKey": "<octane_api_key>", "dealerId": "<dealer_id>", "sandbox": false, "standardApr": 9.99 }
```

**Code to confirm against Octane's docs:**
- `templates/crm-rv/backend/src/services/financing.ts` → `octaneProvider.createApplication()`
  - Currently: `POST {base}/prequalifications` with `Authorization: Bearer <apiKey>` + `X-Dealer-Id`, body `{ dealerId, requestedAmount, applicant, assetType }`.
  - **Confirm:** exact path, auth header name, request fields, and the response fields to map (`prequalificationId`, `offerUrl`/`applicationUrl`).
  - `base` = `https://api.octane.co/v1` (prod) / `https://api.sandbox.octane.co/v1` — **verify the real base URL**.
- Route already mounted: `POST /api/financing/applications` (calls `createFinancingApplication('octane', …)`), `GET /api/financing/providers`.

**Done already:** provider registry, config plumbing, DB persistence (`financingApplication`), the `getOptions` estimate. Only the live `createApplication` call needs confirming.

---

## 2. J.D. Power (formerly NADA Guides) — trade-in book values

**Account:** License **J.D. Power Valuation Services / Values API** for the books you sell (RV, powersports, marine are often **separate datasets** — confirm you license each you need).

**They issue:** API Key (and sandbox), and the dataset/period identifiers.

**Where the key goes** — `company.integrations.valuation.jdpower`:
```json
{ "enabled": true, "apiKey": "<jdpower_api_key>", "period": "0", "sandbox": false }
```

**Code to confirm against J.D. Power's docs:**
- `templates/crm-rv/backend/src/services/valuation.ts` → `jdpowerProvider.getValuation()`
  - Currently: `GET {base}/valuation?period=&vin=&mileage=&region=` with header `api-key`.
  - **Confirm:** path, auth header name, query params (VIN vs UVC, mileage/hours, region/zip), and the **response field names** to map → we read `roughTradeIn / averageTradeIn / cleanTradeIn / retail`. Adjust the mapping to their actual fields.
  - `base` = `https://api.jdpower.ai/valuationservices/v5` — **verify**.
- Route already mounted: `POST /api/valuation/estimate`, `GET /api/valuation/providers`.

---

## 3. Black Book — trade-in values (alternative/secondary)

**Account:** Black Book data API (values by VIN/UVC, with condition adjustments).

**Where the key goes** — `company.integrations.valuation.blackbook`:
```json
{ "enabled": true, "apiKey": "<blackbook_api_key>" }
```

**Code:** `valuation.ts` → `blackbookProvider.getValuation()` is a **stub** ("coming soon"). To go live, implement the fetch using the same return shape (`tradeIn/retail/low/average/high`). ~15 lines, mirrors the J.D. Power provider.

---

## 4. Stripe — reserve-with-deposit (the dealer's own Stripe)

**Account:** the **dealer's** Stripe account → create a **restricted secret key** with Checkout write permission.

**Where the key goes** — website `data/reserve-config.json` (per-site, like the DMS feed config):
```json
{ "enabled": true, "stripeSecretKey": "rk_live_…", "depositAmount": 500, "currency": "usd" }
```

**Code (already complete):** `templates/website-rv/server-static.ts` → `POST /reserve/:stock` creates a Stripe Checkout Session via the REST API and returns `checkoutUrl`. The button + flow are live; it just falls back to a reservation lead until this config is set.

**Optional hardening:** add a Stripe **webhook** (`checkout.session.completed`) to confirm payment server-side before treating a unit as held (today the success page is the signal).

---

## 5. Website → CRM wiring (turn "captures a lead" into "shows a number")

Today the website **"Get Pre-Qualified"** and **"Value My Trade"** forms capture leads (`/api/admin/leads`). To show the *live* prequal offer / trade value, point them at the CRM (for CRM-connected tenants):
- Website already has `CRM_API_URL` set on flipped tenants.
- Add a public, token-gated proxy on the CRM (or reuse `X-Factory-Key`): `POST {CRM}/api/valuation/estimate` and `POST {CRM}/api/financing/applications`.
- Then the website form calls it and renders the result (offer link / value band) instead of only thanking the user.

This is the last wiring step **after** the accounts above are live — small, and the same for both.

---

## Quick reference — config locations

| Integration | Config home | Key field(s) | Live API call to confirm |
|---|---|---|---|
| Octane financing | `company.integrations.financing.octane` | `apiKey`, `dealerId` | `financing.ts` → `octaneProvider.createApplication` |
| J.D. Power valuation | `company.integrations.valuation.jdpower` | `apiKey` | `valuation.ts` → `jdpowerProvider.getValuation` |
| Black Book valuation | `company.integrations.valuation.blackbook` | `apiKey` | `valuation.ts` → `blackbookProvider.getValuation` (stub) |
| Reserve deposit | website `data/reserve-config.json` | `stripeSecretKey` | `server-static.ts` → `POST /reserve/:stock` (done) |
