# {{COMPANY_NAME}} — Pricing Tool

In-home sales pricing application built with Twomiah Factory.

## Stack

- **Backend**: Bun + Hono + Drizzle ORM + PostgreSQL
- **Frontend**: React + Vite + Tailwind CSS + Zustand

## Quick Start

```bash
# Backend
cd backend
cp .env.template .env   # fill in values
bun install
bun run db:push
bun run db:seed
bun run dev

# Frontend
cd frontend
cp .env.template .env
bun install
bun run dev
```

## Features

- Pricebook management (categories, products, price ranges, addons)
- Quote builder with good/better/best tier pricing
- Customer presentation mode optimized for tablet
- E-signature and contract generation
- Territory-based pricing
- Financing integration (Wisetack)
- Commission tracking
- BLS inflation data overlay
- CSV/XLSX pricebook import
- CRM sync
- Offline support
