# Deployment Guide

## Render (Recommended)

1. Copy `render.yaml.template` to `render.yaml` and replace `{{COMPANY_SLUG}}` tokens
2. Push to GitHub
3. Connect repo in Render dashboard
4. Set environment variables in Render:
   - `DATABASE_URL` (auto-set from Render Postgres)
   - `JWT_SECRET` (auto-generated)
   - `FRONTEND_URL`
   - R2 credentials (if using resource library)
   - Wisetack credentials (if using financing)
   - SMTP credentials (if using email)

## Docker

```bash
# Replace tokens in docker-compose.yml
docker-compose up -d
```

## Environment Variables

See `backend/.env.template` for all required and optional variables.

## Database

```bash
bun run db:generate   # Generate migrations from schema
bun run db:migrate    # Run migrations
bun run db:push       # Push schema directly (dev only)
bun run db:seed       # Seed initial data
```

Set `SEED_DEMO=true` to include demo pricebook data.
