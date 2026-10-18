// CSV import (Settings › Import, and the onboarding's contacts step). Moved from
// templates/crm/backend/src/routes/import.ts; the work is in importService.ts. The registry signs the person in; the
// whole module is admin and owner only, as the template had it.
import { Hono } from 'hono'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { createImportService } from './importService.ts'
import { uploadedForm } from './upload.ts'

export function createImportRoutes(d: CrmDeps) {
  const importService = createImportService(d)
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requireRole('admin', 'owner'))

  // The sample CSV for a type: a download, not a JSON reply.
  app.get('/template/:type', async (c) => {
    const type = c.req.param('type')
    const template = importService.getTemplate(type)
    if (!template) return fail(c, 400, 'Invalid template type')
    return c.body(template, 200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=${type}-template.csv`,
    })
  })

  // Preview import (validate without saving)
  app.post('/preview/:type', async (c) => {
    const type = c.req.param('type')
    const formData = await uploadedForm(c)
    const file = formData.get('file') as File | null
    if (!file) return fail(c, 400, 'No file uploaded')
    return one(c, importService.previewImport(await file.text(), type))
  })

  app.post('/contacts', async (c) => {
    const user = c.get('user') as any
    const formData = await uploadedForm(c)
    const file = formData.get('file') as File | null
    if (!file) return fail(c, 400, 'No file uploaded')

    const csvContent = await file.text()
    const skipDuplicates = formData.get('skipDuplicates')
    const updateExisting = formData.get('updateExisting')
    const defaultType = formData.get('defaultType')
    const options = {
      skipDuplicates: skipDuplicates !== 'false',
      updateExisting: updateExisting === 'true',
      defaultType: (defaultType as string) || 'client',
    }

    const results = await importService.importContacts(csvContent, user.companyId, options)

    d.audit.log({ req: c,
      action: 'IMPORT',
      entity: 'contacts',
      metadata: { imported: results.imported, skipped: results.skipped, filename: file.name },
      userId: user.userId,
      companyId: user.companyId,
    })

    return one(c, results)
  })

  app.post('/projects', async (c) => {
    const user = c.get('user') as any
    const formData = await uploadedForm(c)
    const file = formData.get('file') as File | null
    if (!file) return fail(c, 400, 'No file uploaded')

    const csvContent = await file.text()
    const skipDuplicates = formData.get('skipDuplicates')
    const results = await importService.importProjects(csvContent, user.companyId, { skipDuplicates: skipDuplicates !== 'false' })

    d.audit.log({ req: c,
      action: 'IMPORT',
      entity: 'projects',
      metadata: { imported: results.imported, skipped: results.skipped },
      userId: user.userId,
      companyId: user.companyId,
    })

    return one(c, results)
  })

  app.post('/jobs', async (c) => {
    const user = c.get('user') as any
    const formData = await uploadedForm(c)
    const file = formData.get('file') as File | null
    if (!file) return fail(c, 400, 'No file uploaded')

    const results = await importService.importJobs(await file.text(), user.companyId)

    d.audit.log({ req: c,
      action: 'IMPORT',
      entity: 'jobs',
      metadata: { imported: results.imported, skipped: results.skipped },
      userId: user.userId,
      companyId: user.companyId,
    })

    return one(c, results)
  })

  app.post('/products', async (c) => {
    const user = c.get('user') as any
    const formData = await uploadedForm(c)
    const file = formData.get('file') as File | null
    if (!file) return fail(c, 400, 'No file uploaded')

    const results = await importService.importProducts(await file.text(), user.companyId)

    d.audit.log({ req: c,
      action: 'IMPORT',
      entity: 'products',
      metadata: { imported: results.imported, skipped: results.skipped },
      userId: user.userId,
      companyId: user.companyId,
    })

    return one(c, results)
  })

  // Import invoices (open balances are what a switching business cannot re-key)
  app.post('/invoices', async (c) => {
    const user = c.get('user') as any
    const formData = await uploadedForm(c)
    const file = formData.get('file') as File | null
    if (!file) return fail(c, 400, 'No file uploaded')

    const results = await importService.importInvoices(await file.text(), user.companyId, {
      dryRun: formData.get('dryRun') === 'true',
      skipDuplicates: formData.get('skipDuplicates') !== 'false',
      createMissingContacts: formData.get('createMissingContacts') !== 'false',
    })

    return one(c, results)
  })

  return app
}
