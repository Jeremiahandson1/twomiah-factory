import { execSync } from 'child_process'

const MAX_RETRIES = 20
const RETRY_DELAY_MS = 10000

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    console.log(`[migrate] Attempt ${attempt}/${MAX_RETRIES}...`)
    execSync('bun x drizzle-kit migrate', { stdio: 'inherit' })
    console.log('[migrate] Success')
    process.exit(0)
  } catch (err: any) {
    // WHAT FAILED, not "the connection". (T58d)
    //
    // This loop exists because Render starts the service before Postgres accepts connections, so a
    // refused connection is worth waiting for. Everything else is not: a syntax error in a
    // migration fails exactly the same way twenty times, and calling it a connection problem is how
    // crm-vet spent four days unable to apply migrations 0029 to 0034 while its log blamed the
    // database. The start command swallows the exit code and `drizzle-kit push --force` papers over
    // the schema afterwards, so this message is the only warning anyone ever gets.
    const text = [err?.message, err?.cause?.message, String(err)].filter(Boolean).join(' | ')
    const isConnection = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|starting up|not yet accepting|terminating connection|Connection terminated|socket hang up|password authentication failed/i.test(text)

    if (!isConnection) {
      console.error('')
      console.error('[migrate] A MIGRATION FAILED. This is not a connection problem and retrying will not fix it.')
      console.error(`[migrate] ${text.split('\n')[0]}`)
      console.error('[migrate] Every migration in this run was rolled back — drizzle applies a run in ONE')
      console.error('[migrate] transaction — so this migration AND EVERY MIGRATION AFTER IT is unapplied.')
      console.error('[migrate] The service will still start, because the start command continues past this and')
      console.error('[migrate] drizzle-kit push reconciles what it can from schema.ts. Anything a migration does')
      console.error('[migrate] that push cannot — a data fix, a partial index not declared in schema.ts — has not')
      console.error('[migrate] happened. Fix the migration and redeploy.')
      console.error('')
      process.exit(1)
    }

    if (attempt === MAX_RETRIES) {
      console.error(`[migrate] Could not reach the database after ${MAX_RETRIES} attempts: ${text.split('\n')[0]}`)
      process.exit(1)
    }
    console.log(`[migrate] Database not reachable yet, retrying in ${RETRY_DELAY_MS / 1000}s...`)
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
  }
}
