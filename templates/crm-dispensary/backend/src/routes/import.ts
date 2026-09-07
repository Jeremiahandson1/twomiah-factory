import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import importService from '../services/import.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireRole('admin'))

// This dispensary CRM only imports contacts and products. `projects`/`jobs` belong to
// other verticals and have no table here, so those endpoints return a clear 400.
const SUPPORTED_IMPORT_TYPES = ['contacts', 'products']

// Read the uploaded CSV file from multipart form data, returning a typed error string
// instead of throwing a 500 when the body is missing or not multipart.
async function readUploadedFile(c: any): Promise<{ file: File } | { error: string }> {
  let file: File | null = null
  try {
    const formData = await c.req.formData()
    file = formData.get('file') as File | null
  } catch {
    return { error: 'Expected multipart/form-data with a "file" field' }
  }
  if (!file || typeof (file as any).text !== 'function') {
    return { error: 'No file uploaded' }
  }
  return { file }
}

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

  if (!SUPPORTED_IMPORT_TYPES.includes(type)) {
    return c.json({ error: `Unsupported import type: ${type}. Supported types: ${SUPPORTED_IMPORT_TYPES.join(', ')}` }, 400)
  }

  const upload = await readUploadedFile(c)
  if ('error' in upload) return c.json({ error: upload.error }, 400)

  const csvContent = await upload.file.text()
  const preview = await importService.previewImport(csvContent, type, user.companyId)

  return c.json(preview)
})

// Import contacts
app.post('/contacts', async (c) => {
  const user = c.get('user') as any

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return c.json({ error: 'Expected multipart/form-data with a "file" field' }, 400)
  }
  const file = formData.get('file') as File | null
  if (!file || typeof (file as any).text !== 'function') {
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

// Import projects — not supported in the dispensary CRM (no projects table)
app.post('/projects', async (c) => {
  return c.json({ error: 'Unsupported import type: projects. This CRM supports importing contacts and products only.' }, 400)
})

// Import jobs — not supported in the dispensary CRM (no jobs table)
app.post('/jobs', async (c) => {
  return c.json({ error: 'Unsupported import type: jobs. This CRM supports importing contacts and products only.' }, 400)
})

// Import products
app.post('/products', async (c) => {
  const user = c.get('user') as any

  const upload = await readUploadedFile(c)
  if ('error' in upload) return c.json({ error: upload.error }, 400)

  const csvContent = await upload.file.text()
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
