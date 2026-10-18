// Migrations are generated from the schema (`bun run db:generate`) and committed with every schema change.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
})
