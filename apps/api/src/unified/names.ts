/**
 * The names a unified tenant's resources take: one repo, one Render web service and one Render Postgres server of its
 * own (docs/SPEC_UNIFIED_PRODUCT.md §0, decisions 2 and 4).
 *
 * `-app` keeps every name apart from the templates' (repo `<slug>`, services `<slug>-site` / `<slug>-api` / …,
 * database `<slug>-db`), so a business moving across keeps its old services running until its domain is switched.
 */
export const UNIFIED_SUFFIX = '-app'

/** Postgres identifiers are at most 63 bytes; the database name is the slug with underscores. */
export const MAX_SLUG = 60

export interface UnifiedNames {
  repo: string
  service: string
  /** The Render Postgres server's name. */
  database: string
  /** The database (and its user) inside that server. */
  databaseName: string
}

export function unifiedNames(slug: string): UnifiedNames {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error(`'${slug}' is not a slug (lower-case letters, digits, single dashes)`)
  if (slug.length > MAX_SLUG) throw new Error(`slug '${slug}' is longer than ${MAX_SLUG} characters`)
  return {
    repo: slug + UNIFIED_SUFFIX,
    service: slug + UNIFIED_SUFFIX,
    database: slug + UNIFIED_SUFFIX + '-db',
    databaseName: slug.replace(/-/g, '_'),
  }
}
