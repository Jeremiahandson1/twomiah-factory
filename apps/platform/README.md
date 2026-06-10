# Factory Platform

React + Vite admin dashboard for the Twomiah Factory. Internal tool — manage tenants, run the factory wizard, review premium-site compositions and roof reports, handle billing, support, and pricing.

## Auth

Supabase email/password sessions; the bearer token from the session is sent to the Factory API on every request. Role gating (owner/admin/editor/viewer) via the `RequireRole` component.

## Layout

```
src/
  pages/          Dashboard, FactoryPage (11-step tenant wizard), TenantsPage,
                  CustomerDetailPage, PremiumReviewPage, RoofReviewPage,
                  CareSignupPage + public signup/intake pages, Settings, Support,
                  PricingAdmin, Analytics
  components/     AppLayout, RequireRole, NewTenantModal, factory/ wizard steps
  supabase.ts     Supabase client + API_URL
```

## Run

```bash
bun install
bun run dev      # Vite on :5173
bun run build    # tsc + vite build (same gate CI uses)
```

Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` (defaults to the production Factory API on Render).
