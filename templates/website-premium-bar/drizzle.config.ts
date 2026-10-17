import type { Config } from 'drizzle-kit'

// `bunx drizzle-kit generate` writes db/migrations from db/schema.ts (no database needed).
export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.SITE_DB_PATH || './persistent/site.db' },
} satisfies Config
