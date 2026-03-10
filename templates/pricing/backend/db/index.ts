import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'
import * as estimatorSchema from './schema-estimator'

const allSchema = { ...schema, ...estimatorSchema }
export const db = drizzle(process.env.DATABASE_URL!, { schema: allSchema })
export type DB = typeof db
export { schema, estimatorSchema }
