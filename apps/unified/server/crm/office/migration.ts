// Settings › Migration: move a business across from Jobber, ServiceTitan or Housecall Pro (their APIs), or from a
// CSV export of those and three more. Moved from templates/crm/backend/src/routes/migration.ts. The registry signs the
// person in; the whole module is admin and owner only, as the template had it.
import { Hono } from 'hono'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import { createMigrationService } from './migrationService.ts'
import { createImportService } from './importService.ts'
import { uploadedForm } from './upload.ts'

export function createMigrationRoutes(d: CrmDeps) {
  const migration = createMigrationService(d)
  const importService = createImportService(d)
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requireRole('admin', 'owner'))

  // The providers a business can move from. A list: { data, pagination } (the template answered a bare array).
  app.get('/providers', (c) => {
    const providers = migration.getAvailableProviders()
    return list(c, providers, { page: 1, limit: providers.length, total: providers.length })
  })

  // A platform's CSV column presets for one kind of record
  app.get('/presets/:provider/:entityType', (c) => {
    const provider = c.req.param('provider')
    const entityType = c.req.param('entityType')
    const preset = migration.PLATFORM_PRESETS[provider]
    if (!preset) return fail(c, 404, 'Unknown provider')
    const mapping = preset.csvMappings[entityType]
    if (!mapping) return fail(c, 404, 'No mapping for this entity type')
    return one(c, { provider: preset.name, entityType, columnMappings: mapping })
  })

  // Start an API migration
  app.post('/start', async (c) => {
    const user = c.get('user') as any
    const body = await c.req.json()
    const { provider, credentials } = body
    if (!provider || !credentials) return fail(c, 400, 'Provider and credentials required')

    const preset = migration.PLATFORM_PRESETS[provider]
    if (!preset?.hasApi) return fail(c, 400, `${provider} does not support API migration. Use CSV import instead.`)

    const migrationId = await migration.startMigration(provider, credentials, user.companyId)

    d.audit.log({ req: c,
      action: 'MIGRATION_START',
      entity: 'migration',
      metadata: { provider, migrationId },
      userId: user.userId,
      companyId: user.companyId,
    })

    return one(c, { migrationId, message: `Migration from ${preset.name} started` })
  })

  app.get('/progress/:migrationId', (c) => {
    const progress = migration.getMigrationProgress(c.req.param('migrationId'))
    if (!progress) return fail(c, 404, 'Migration not found')
    return one(c, progress)
  })

  // Import a CSV with a platform preset (the import service's column matching)
  app.post('/csv/:provider/:entityType', async (c) => {
    const user = c.get('user') as any
    const provider = c.req.param('provider')
    const entityType = c.req.param('entityType')

    const formData = await uploadedForm(c)
    const file = formData.get('file') as File | null
    if (!file) return fail(c, 400, 'No file uploaded')

    const csvContent = await file.text()

    let results: any
    switch (entityType) {
      case 'contacts':
        results = await importService.importContacts(csvContent, user.companyId, { skipDuplicates: true })
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
        return fail(c, 400, 'Unknown entity type')
    }

    d.audit.log({ req: c,
      action: 'MIGRATION_CSV',
      entity: entityType,
      metadata: { provider, imported: results.imported, skipped: results.skipped, filename: file.name },
      userId: user.userId,
      companyId: user.companyId,
    })

    return one(c, results)
  })

  return app
}
