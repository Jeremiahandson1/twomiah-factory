# Factory API

Hono backend (Bun runtime) that powers the Twomiah Factory: tenant management, code generation, deployment, billing, and post-launch sync.

## What it does

- **Generate** — builds per-tenant app code from `templates/` (`src/services/generator.ts`), injecting branding, features, and integration tokens
- **Deploy** — pushes generated code to GitHub and provisions Render services + Postgres, wires Cloudflare DNS/zones and SendGrid domain auth (`src/services/deploy.ts`)
- **Compose** — Claude-generated multi-page premium sites from intake data (`src/services/sectionComposer.ts`, 32K-token streaming)
- **Billing** — Stripe subscriptions, checkout, webhooks, CRM add-on auto-provisioning (`src/services/factoryStripe.ts`, `src/services/crmAddonProvision.ts`)
- **Sync** — feature flags and config pushed to live tenants via `POST /api/internal/sync-features` with `X-Factory-Key` auth
- **Lifecycle** — trial warnings, renewal checks, offboarding, test-tenant cleanup (cron endpoints under `/internal/*`, authed by `CRON_SECRET`)

## Layout

```
src/
  index.ts            Hono app entry (port 3001)
  routes/factory.ts   Main route module (tenants, deploys, webhooks, internal crons)
  routes/brief.ts     Intake form / brief builder
  routes/qbwc.ts      QuickBooks Desktop Web Connector (SOAP)
  services/           generator, deploy, sectionComposer, email, factoryStripe, …
  middleware/auth.ts  Supabase JWT validation + RBAC
migrations/           SQL applied to the factory Supabase DB
schema.sql            Factory DB reference schema
scripts/              Operational one-offs (provisioning, audits, verification)
```

## Run

```bash
bun install
cp .env.example .env   # fill in values — see comments per variable
bun run dev            # bun --watch src/index.ts
bun run build          # bundle check (same gate CI uses)
```

The factory DB is Supabase (`SUPABASE_URL` + service role key). Each tenant gets its own Postgres on Render.

## Conventions

- Tenant-facing shared secrets (`X-Factory-Key`, `CRON_SECRET`, webhook secrets) are validated with constant-time comparison — use the `checkFactoryKey` / `checkCronSecret` helpers in `routes/factory.ts`, don't hand-roll `!==` checks
- Never push API code while an Anthropic compose call is in flight — Render's SIGTERM kills the worker mid-compose
- Deploy emails (welcome → ready ~8–10 min later) are part of the product promise; email sends retry transient failures automatically
