import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import importService from '../services/import.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireRole('admin'))

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
    req: { user },
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
    req: { user },
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
    req: { user },
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
    req: { user },
  })

  return c.json(results)
})

export default app
