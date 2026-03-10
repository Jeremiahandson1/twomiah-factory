import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './index'

await migrate(db, { migrationsFolder: './db/migrations' })
console.log('Migrations complete')
process.exit(0)
