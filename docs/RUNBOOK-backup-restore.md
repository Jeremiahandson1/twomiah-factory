# Runbook — tenant database backup and restore

Everything below was verified against the live Render account on 2026-08-07,
not taken from documentation.

## What protection actually exists

**Render gives these databases no backups we can use.** Tenant databases run on
`basic_256mb`. The Render API returns 404 for `/backups`, `/recovery-info`,
`/exports` and `/snapshots` on those instances — point-in-time recovery starts
on higher plans. So:

- there is **no automatic restore point** for a tenant database
- the only dump that ever ran before this runbook existed was the offboard
  export — data was captured once, on the customer's way out
- backups now come from `scripts/backup-tenant.ts`, and nothing else takes them

**External access is closed by default.** Every tenant database has an empty
`ipAllowList`, which means Render refuses connections from anywhere except
inside Render. A restore from a laptop does not work until you open it (step 1
below). This is a good default — just know it is there, because it is the first
thing that will stop you at 2am.

## Taking a backup

From inside Render (a shell on the factory service), or from a laptop with
access opened:

```bash
cd apps/api
bun run scripts/backup-tenant.ts <tenant-slug>   # one tenant, all its databases
bun run scripts/backup-tenant.ts --all           # every active tenant
```

Archives land in R2 under `db-backups/<database-name>/`. A tenant with a CRM
and a website has **two** databases and gets two archives — they are never
merged, because a merged archive makes the restore ambiguous.

The archive is data-only JSON: every table in the public schema, minus
migration bookkeeping and session tables. Schema is not included on purpose —
it comes from the tenant's own drizzle migrations, which run at boot.

## Restoring

Recovery order matters:

1. **Open external access** (skip if running inside Render). On the database in
   the Render dashboard, add your public IP to the allow list — or:
   ```bash
   curl -X PATCH -H "Authorization: Bearer $RENDER_API_KEY" \
     -H "Content-Type: application/json" \
     https://api.render.com/v1/postgres/<db-id> \
     -d '{"ipAllowList":[{"cidrBlock":"<your.ip>/32","description":"restore"}]}'
   ```
   **Close it again when you are done** (`{"ipAllowList":[]}`).

2. **Make sure the schema exists.** If the database is new or empty, deploy the
   tenant first and let its migrations run. Restore never creates tables; it
   will tell you which ones are missing rather than inventing them.

3. **Dry run first.** This is the default and it writes nothing:
   ```bash
   bun run scripts/restore-tenant.ts <tenant-slug> ./backup.json
   ```
   Read the table list. Confirm the row counts look like the tenant you expect.

4. **Restore for real:**
   ```bash
   # fill gaps only — existing rows are left alone (ON CONFLICT DO NOTHING)
   bun run scripts/restore-tenant.ts <tenant-slug> ./backup.json --live

   # replace table contents — use after data loss or corruption
   bun run scripts/restore-tenant.ts <tenant-slug> ./backup.json --truncate --live
   ```

Each table loads in its own transaction, so a failure on one table cannot leave
another half-written. A table present in the backup but missing from the target
is reported as a failure, never skipped quietly.

## Verifying the machinery still works

```bash
cd apps/api
bun run scripts/backup-restore-selftest.ts <test-tenant-slug>
```

It creates its own throwaway table in that tenant's database, fills it, backs it
up, wipes it, restores it, and checks the rows came back — including quotes,
commas, nulls and numeric precision — then drops the table. **It never touches
customer data.** Run it against a test tenant after any change to the backup
code.

Last verified: 9/9 passing against `storetest-msdoio52-b0db`, 2026-08-07.

## Known gaps — be honest about these

- **Backups are not scheduled yet.** `--all` exists and works; wiring it into
  the daily cron is a decision about R2 storage cost and retention that has not
  been made. Until then, backups are manual.
- **No retention policy.** Nothing prunes `db-backups/` in R2.
- **Restore refuses multi-database tenants** rather than guessing which archive
  belongs where. Point `tenants.database_url` at the intended database and
  restore one at a time.
- **Uploads are single-shot.** Very large tenants (~500MB+) need multipart
  upload; the exporter says so in its own comments.
- If a tenant's data matters enough that hours of loss is unacceptable, the real
  answer is upgrading that database to a Render plan with point-in-time
  recovery. This runbook is the floor, not a substitute for it.
