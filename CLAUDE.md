# Twomiah Factory

Multi-tenant SaaS platform that generates, deploys, and manages CRM + website software for service businesses.

## Architecture

- **Monorepo** — Turbo + Bun workspaces
- **apps/api** — Hono backend (Bun runtime). Manages tenants, deploys code to GitHub/Render, syncs features via HTTP.
- **apps/platform** — React admin dashboard (Vite). Internal tool for managing tenants, features, billing, support.
- **apps/mobile** — React Native + Expo. Field technician mobile app.
- **packages/** — Shared types, UI components, utilities (minimal currently).

## Templates

Each template is a standalone app that gets generated per tenant and deployed to Render.

### CRM Templates

Which template a signup gets is decided in `apps/api/src/config/industryRouting.ts`
— that file is the single source of truth for industry → CRM/website mapping.

Recurring-job model (contacts → jobs → quotes → invoices):
- `crm` — General contractor CRM (the base/default, and the fallback)
- `crm-fieldservice` — HVAC, plumbing, electrical, cleaning, pest, handyman
- `crm-homecare` — Home health/caregiving agencies
- `crm-roof` — Roofing contractors
- `crm-landscaping` — Landscaping, lawn care, tree service
- `crm-dispensary` — Cannabis retail

Other archetypes (NOT the recurring-job model):
- `crm-rv` — RV/powersports/auto dealerships. Sales-floor model: inventory,
  leads, deals, trade-ins, service
- `crm-vet` — Veterinary practices. Retention model: patients, appointments,
  visits, vaccinations, reminders, wellness plans
- `crm-salon` — Salons, barbers, nail/lash bars, spas. Retention model:
  service menu → the book → formula record → rebooking reminder
- `crm-restaurant` — Restaurants, caterers, event venues. Scoped to PRIVATE
  EVENTS (enquiry → booking → deposit → banquet event order), not POS/covers
- `crm-store` — E-commerce back-office behind the `website-store` storefront

- `crm-automotive` — **Parked** (not actively developed; auto dealers route to
  `crm-rv` instead)

Adding a vertical touches more than the template dir: `industryRouting.ts`,
`featureRegistry.ts`, `deploy.ts` (service naming + rootDir), `email.ts`,
`testCleanup.ts` (BOTH suffix sweeps, or teardown orphans Render services),
`emailDefaults.ts`, and the platform's `StepFeatures.tsx`. The template's own
`shared/plans.ts` needs the vertical's feature ids too — `startup/featureSync.ts`
falls back to it and would otherwise hide the whole sidebar.

### Website Templates
- `website-contractor`, `website-fieldservice`, `website-general`, `website-homecare`
- Express + EJS, each with its own CMS

### Other
- `cms` — Standalone CMS dashboard
- `pricing` — Pricing/subscription management

## Key Patterns

- CRM templates: Hono backend + Drizzle ORM + React frontend, served as SPA from backend
- Feature gating: `hasFeature()` in frontend AuthContext, `enabledFeatures` array in company table
- Factory-to-CRM sync: HTTP POST to `/api/internal/sync-features` with `X-Factory-Key` header
- Deploy pipeline: Factory API generates code → pushes to GitHub → Render deploys from GitHub
- All CRM templates share the same `CustomerPortal` landing page pattern with product/service cards

## Database

- Factory DB: Supabase (tenants, factory_jobs, support_tickets, etc.) — see `apps/api/schema.sql`
- Each tenant gets their own PostgreSQL DB on Render with Drizzle ORM schema

## Commands

```bash
bun install          # Install all dependencies
bun run dev          # Start API + Platform in dev mode (turbo)
cd apps/api && bun run dev      # API only
cd apps/platform && bun run dev # Platform only
```

## Conventions

- Do NOT modify crm-automotive — it is parked
- Template bun.lock files are gitignored (generated on install)
- Exterior Visualizer — not "Room Visualizer" or "Home Visualizer" (interior rendering not production-ready)
- Pricebook is both a core feature at higher tiers AND a standalone add-on
