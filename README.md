# Twomiah Factory

A monorepo for the Twomiah platform — generates, deploys, and manages SaaS tenants (websites, CRMs, CMS dashboards).

## Structure

```
apps/
  api/        — Hono API server (Bun)
  platform/   — Admin dashboard (React + Vite)
packages/
  types/      — Shared TypeScript types
  ui/         — Shared UI components
  utils/      — Shared utilities
templates/
  cms/              — React CMS frontend
  crm/              — General CRM (Express + React)
  crm-homecare/     — Home care CRM (Express + Prisma + React)
  website-contractor/  — Contractor website (Express + EJS)
  website-general/     — General business website (Express + EJS)
  website-homecare/    — Home care website (Express + EJS)
```

## Setup

```bash
bun install
cp apps/api/.env.example apps/api/.env   # then fill in values
```

## Development

```bash
bun run dev      # starts API + platform via Turbo
bun run build    # builds all packages and apps
bun run lint     # lints all packages
```
