import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import importService from '../services/import.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireRole('admin', 'owner'))

// Get CSV template
app.get('/template/:type', async (c) => {
  const type = c.req.param('type')
  const template = importService.getTemplate(type)

  if (!template) {
    return c.json({ error: 'Invalid template type' }, 400)
  }

  return new Response(template, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=${type}-template.csv`,
    },
  })
})

// Preview import (validate without saving)
app.post('/preview/:type', async (c) => {
  const user = c.get('user') as any
  const type = c.req.param('type')

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

  const csvContent = await file.text()
  const preview = await importService.previewImport(csvContent, type, user.companyId)

  return c.json(preview)
})

// Import contacts
app.post('/contacts', async (c) => {
  const user = c.get('user') as any

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

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

  audit.log({
    action: 'IMPORT',
    entity: 'contacts',
    metadata: {
      imported: results.imported,
      skipped: results.skipped,
      filename: file.name,
    },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(results)
})

// Import projects
app.post('/projects', async (c) => {
  const user = c.get('user') as any

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

  const csvContent = await file.text()
  const skipDuplicates = formData.get('skipDuplicates')

  const options = {
    skipDuplicates: skipDuplicates !== 'false',
  }

  const results = await importService.importProjects(csvContent, user.companyId, options)

  audit.log({
    action: 'IMPORT',
    entity: 'projects',
    metadata: { imported: results.imported, skipped: results.skipped },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(results)
})

// Import jobs
app.post('/jobs', async (c) => {
  const user = c.get('user') as any

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

  const csvContent = await file.text()
  const results = await importService.importJobs(csvContent, user.companyId)

  audit.log({
    action: 'IMPORT',
    entity: 'jobs',
    metadata: { imported: results.imported, skipped: results.skipped },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(results)
})

// Import products
app.post('/products', async (c) => {
  const user = c.get('user') as any

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

  const csvContent = await file.text()
  const results = await importService.importProducts(csvContent, user.companyId)

  audit.log({
    action: 'IMPORT',
    entity: 'products',
    metadata: { imported: results.imported, skipped: results.skipped },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(results)
})

// Import invoices (open balances are what a switching business cannot re-key)
app.post('/invoices', async (c) => {
  const user = c.get('user') as any
  const formData = await c.req.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

  const csvContent = await file.text()
  const dryRun = formData.get('dryRun') === 'true'
  const skipDuplicates = formData.get('skipDuplicates') !== 'false'
  const createMissingContacts = formData.get('createMissingContacts') !== 'false'

  const results = await importService.importInvoices(csvContent, user.companyId, {
    dryRun,
    skipDuplicates,
    createMissingContacts,
  })

  return c.json(results)
})

// Import events / spaces / menu packages (venue vertical) — the CSV importer had
// no way to bring in a venue's core data (H-02).
const venueImport = (handler: 'importEvents' | 'importSpaces' | 'importMenus', entity: string) =>
  async (c: any) => {
    const user = c.get('user') as any
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'No file uploaded' }, 400)
    const csvContent = await file.text()
    const options = {
      dryRun: formData.get('dryRun') === 'true',
      skipDuplicates: formData.get('skipDuplicates') !== 'false',
      createContacts: formData.get('createMissingContacts') !== 'false',
    }
    const results = await (importService as any)[handler](csvContent, user.companyId, options)
    audit.log({ action: 'IMPORT', entity, metadata: { imported: results.imported, skipped: results.skipped }, userId: user.userId, companyId: user.companyId })
    return c.json(results)
  }

app.post('/events', venueImport('importEvents', 'events'))
app.post('/spaces', venueImport('importSpaces', 'spaces'))
app.post('/menus', venueImport('importMenus', 'menus'))

export default app
