import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import migration from '../services/migration.ts'
import importService from '../services/import.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireRole('admin', 'owner'))

// List available migration providers
app.get('/providers', (c) => {
  return c.json(migration.getAvailableProviders())
})

// Get platform-specific CSV column presets
app.get('/presets/:provider/:entityType', (c) => {
  const provider = c.req.param('provider')
  const entityType = c.req.param('entityType')
  const preset = migration.PLATFORM_PRESETS[provider]

  if (!preset) return c.json({ error: 'Unknown provider' }, 404)

  const mapping = preset.csvMappings[entityType]
  if (!mapping) return c.json({ error: 'No mapping for this entity type' }, 404)

  return c.json({ provider: preset.name, entityType, columnMappings: mapping })
})

// Start an API migration
app.post('/start', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const { provider, credentials } = body

  if (!provider || !credentials) {
    return c.json({ error: 'Provider and credentials required' }, 400)
  }

  const preset = migration.PLATFORM_PRESETS[provider]
  if (!preset?.hasApi) {
    return c.json({ error: `${provider} does not support API migration. Use CSV import instead.` }, 400)
  }

  const migrationId = await migration.startMigration(provider, credentials, user.companyId)

  audit.log({
    action: 'MIGRATION_START',
    entity: 'migration',
    metadata: { provider, migrationId },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json({ migrationId, message: `Migration from ${preset.name} started` })
})

// Get migration progress
app.get('/progress/:migrationId', (c) => {
  const migrationId = c.req.param('migrationId')
  const progress = migration.getMigrationProgress(migrationId)

  if (!progress) return c.json({ error: 'Migration not found' }, 404)

  return c.json(progress)
})

// Import CSV with platform preset (enhanced import)
app.post('/csv/:provider/:entityType', async (c) => {
  const user = c.get('user') as any
  const provider = c.req.param('provider')
  const entityType = c.req.param('entityType')

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file uploaded' }, 400)

  const csvContent = await file.text()

  // Use existing import service with platform-aware column matching
  let results: any
  switch (entityType) {
    case 'contacts':
      results = await importService.importContacts(csvContent, user.companyId, {
        skipDuplicates: true,
      })
      break
    case 'projects':
      results = await importService.importProjects(csvContent, user.companyId)
      break
    case 'jobs':
      results = await importService.importJobs(csvContent, user.companyId)
      break
    case 'products':
      results = await importService.importProducts(csvContent, user.companyId)
      break
    default:
      return c.json({ error: 'Unknown entity type' }, 400)
  }

  audit.log({
    action: 'MIGRATION_CSV',
    entity: entityType,
    metadata: { provider, imported: results.imported, skipped: results.skipped, filename: file.name },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(results)
})

export default app
