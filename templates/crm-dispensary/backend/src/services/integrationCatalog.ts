// The integrations this CRM can actually do something with, stated once.
//
// Dispensary T21 L7 — the Integrations Marketplace reported "No integrations found". The reported
// cause was that the route did not exist; it does, and answers 200. GET /api/marketplace/partners
// returned `[]` because integration_partners is a CATALOGUE table that nothing ever populated: the
// page was faithfully showing an empty shelf. (The probes in the report, /api/marketplace and
// /api/marketplace/integrations, are paths the page never calls, which is why they 404.)
//
// Every entry below maps to a route in this template that implements it. Nothing is listed that the
// product cannot actually connect to — an empty shelf is better than a shelf of things that do not work.
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'

export interface CatalogEntry {
  slug: string
  name: string
  category: 'menu' | 'compliance'
  description: string
  websiteUrl: string
  authType: 'api_key' | 'oauth2' | 'basic'
  featured?: boolean
  configSchema: Record<string, unknown>
}

const apiKeyConfig = (label: string) => ({
  type: 'object',
  required: ['apiKey'],
  properties: { apiKey: { type: 'string', title: label, format: 'password' } },
})

export const INTEGRATION_CATALOG: CatalogEntry[] = [
  // Menu syndication — routes/menu-sync.ts publishes the live menu to each of these.
  {
    slug: 'weedmaps', name: 'Weedmaps', category: 'menu', featured: true,
    description: 'Publish your live menu and stock levels to your Weedmaps storefront.',
    websiteUrl: 'https://weedmaps.com', authType: 'api_key',
    configSchema: apiKeyConfig('Weedmaps API key'),
  },
  {
    slug: 'leafly', name: 'Leafly', category: 'menu', featured: true,
    description: 'Publish your live menu and stock levels to your Leafly dispensary page.',
    websiteUrl: 'https://leafly.com', authType: 'api_key',
    configSchema: apiKeyConfig('Leafly API key'),
  },
  {
    slug: 'iheartjane', name: 'Jane', category: 'menu',
    description: 'Syndicate your menu to Jane for online ordering.',
    websiteUrl: 'https://iheartjane.com', authType: 'api_key',
    configSchema: apiKeyConfig('Jane API key'),
  },
  {
    slug: 'dutchie_marketplace', name: 'Dutchie Marketplace', category: 'menu',
    description: 'Syndicate your menu to the Dutchie marketplace.',
    websiteUrl: 'https://dutchie.com', authType: 'api_key',
    configSchema: apiKeyConfig('Dutchie API key'),
  },
  // Track-and-trace — routes/metrc.ts, routes/biotrack.ts, routes/leaf-data.ts.
  {
    slug: 'metrc', name: 'METRC', category: 'compliance', featured: true,
    description: 'State track-and-trace: sync packages, transfers and sales receipts.',
    websiteUrl: 'https://metrc.com', authType: 'api_key',
    configSchema: {
      type: 'object',
      required: ['vendorKey', 'userKey', 'licenseNumber'],
      properties: {
        vendorKey: { type: 'string', title: 'Vendor API key', format: 'password' },
        userKey: { type: 'string', title: 'User API key', format: 'password' },
        licenseNumber: { type: 'string', title: 'License number' },
      },
    },
  },
  {
    slug: 'biotrack', name: 'BioTrack', category: 'compliance',
    description: 'State track-and-trace for BioTrack jurisdictions.',
    websiteUrl: 'https://biotrack.com', authType: 'basic',
    configSchema: {
      type: 'object',
      required: ['username', 'password', 'licenseNumber'],
      properties: {
        username: { type: 'string', title: 'Username' },
        password: { type: 'string', title: 'Password', format: 'password' },
        licenseNumber: { type: 'string', title: 'License number' },
      },
    },
  },
  {
    slug: 'leaf_data', name: 'Leaf Data Systems', category: 'compliance',
    description: 'State track-and-trace for Leaf Data jurisdictions.',
    websiteUrl: 'https://lcb.wa.gov', authType: 'api_key',
    configSchema: {
      type: 'object',
      required: ['apiKey', 'mmeCode'],
      properties: {
        apiKey: { type: 'string', title: 'Leaf Data API key', format: 'password' },
        mmeCode: { type: 'string', title: 'MME code' },
      },
    },
  },
]

// Idempotent, keyed on slug, run at boot so a tenant that already exists gets the shelf stocked too —
// a seed that only runs at tenant creation would leave every live dispensary looking at the empty page
// this fixes. Updates the copy on an entry that has changed; never touches a tenant's own credentials,
// which live in company_integrations.
export async function ensureIntegrationPartners(): Promise<number> {
  // Matched on slug by hand rather than ON CONFLICT: the unique index on slug is declared in the
  // Drizzle schema but a table reconciled onto an existing tenant may not carry it, and ON CONFLICT
  // without a matching constraint is a hard error at boot. This is idempotent either way.
  let written = 0
  for (const e of INTEGRATION_CATALOG) {
    const found: any = await db.execute(sql`SELECT id FROM integration_partners WHERE slug = ${e.slug} LIMIT 1`)
    const existing = ((found as any).rows || found)?.[0]
    if (existing) {
      await db.execute(sql`
        UPDATE integration_partners SET
          name = ${e.name}, category = ${e.category}, description = ${e.description},
          website_url = ${e.websiteUrl}, auth_type = ${e.authType},
          config_schema = ${JSON.stringify(e.configSchema)}::json, is_featured = ${!!e.featured}
        WHERE id = ${existing.id}
      `)
    } else {
      await db.execute(sql`
        INSERT INTO integration_partners (id, slug, name, category, description, website_url, auth_type, config_schema, is_active, is_featured, created_at)
        VALUES (gen_random_uuid(), ${e.slug}, ${e.name}, ${e.category}, ${e.description}, ${e.websiteUrl}, ${e.authType}, ${JSON.stringify(e.configSchema)}::json, true, ${!!e.featured}, NOW())
      `)
    }
    written++
  }
  return written
}
