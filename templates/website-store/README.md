# {{COMPANY_NAME}} Storefront

A Twomiah factory storefront template. This is a **DB-free** Next.js store: it
reads its catalog, runs checkout, and looks up orders entirely through the
`crm-store` backend PUBLIC API. It owns no database, no Stripe keys, and no
admin — those live in the separate `crm-store` service.

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript
- **Tailwind CSS 4** for styling
- **Zustand** for the client cart (persisted in `localStorage`)
- **Render** for hosting (a single Node web service — see `render.yaml.template`)

## Data flow

All catalog reads happen in server components via `src/lib/catalog.ts`, which
fetches the crm-store PUBLIC API (`CRM_STORE_API_URL`, server-only):

| Getter | Endpoint |
| --- | --- |
| `getActiveProducts()` | `GET /api/public/products` |
| `getFeaturedProducts()` | `GET /api/public/products` (filtered by `featured`) |
| `getProductBySlug(slug)` | `GET /api/public/products/{slug}` |

Checkout is a thin proxy: `POST /api/checkout` forwards the cart
(`{ items: [{ sku, quantity }] }`) to `POST /api/public/checkout` on the backend
and redirects to the returned Stripe/hosted checkout `url`. The success page
reads `GET /api/public/order-summary?session_id=...` to confirm the order.

Fetch failures degrade gracefully — getters return `[]`/`null` so the site
still renders (and builds) with no reachable backend.

## Environment

Copy `.env.template` to `.env.local` and fill in:

```
CRM_STORE_API_URL=   # base URL of the crm-store backend
BASE_URL=            # public URL of this storefront
NEXT_PUBLIC_GA_ID=   # optional GA4 measurement id
```

## Local development

```bash
npm install
cp .env.template .env.local   # fill in values
npm run dev
```

## Deployment

`render.yaml.template` is a Render Blueprint for a single Node web service.
Set `CRM_STORE_API_URL` and `BASE_URL` in the service env. The server binds
`$PORT` (default 10000) via the `start` script.
