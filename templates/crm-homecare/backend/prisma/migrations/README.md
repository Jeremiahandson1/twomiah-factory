# Database Migrations

## Fresh Deployments (first deploy to Render)
This template uses `prisma db push` on first deploy, which pushes the schema
directly to the database without needing migration files. No action required.

## After First Deploy — Switch to Migration Workflow
Once a customer's database has live data, `db push` is no longer safe because
it can drop columns. Switch to the migration workflow for all future changes:

```bash
# 1. Make your schema changes in schema.prisma
# 2. Generate a migration (run this against a dev/staging DB, not production)
npx prisma migrate dev --name describe_your_change

# 3. Commit the generated file in migrations/ to git
# 4. Update the Render build command from:
#      npx prisma db push
#    to:
#      npx prisma migrate deploy
# Render will automatically apply new migrations on each deploy.
```

## Why db push on Fresh Installs?
`prisma migrate deploy` only applies existing migration files. This folder
starts empty in generated packages, so `migrate deploy` would run nothing and
the database would never be created — causing an immediate boot failure.
`db push` bypasses migration history and applies the schema directly, which is
safe for brand-new databases.
