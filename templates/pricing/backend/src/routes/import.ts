import { Hono } from 'hono'
import { requireAdmin } from '../middleware/auth'
import {
  parseFile,
  autoDetectMapping,
  validateMapping,
  executeImport,
  generatePricebookTemplate,
  generateEstimatorTemplate,
} from '../services/importService'
import { db } from '../../db/index'

const app = new Hono()

// All routes require admin
app.use('*', requireAdmin)

// ─── POST /parse — Upload file, parse, return columns + sample + auto-mapping ─

app.post('/parse', async (c) => {
  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File
    const importType = (formData.get('importType') as string) || 'pricebook'

    if (!file) {
      return c.json({ error: 'No file provided' }, 400)
    }

    if (file.size > 10 * 1024 * 1024) {
      return c.json({ error: 'File exceeds 10MB limit' }, 400)
    }

    const filename = file.name.toLowerCase()
    if (!filename.endsWith('.csv') && !filename.endsWith('.xlsx') && !filename.endsWith('.xls')) {
      return c.json({ error: 'Unsupported file type. Please upload CSV or XLSX.' }, 400)
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = parseFile(buffer, filename)
    const autoMapping = autoDetectMapping(result.columns, importType as 'pricebook' | 'estimator')

    return c.json({
      ...result,
      autoMapping,
      filename: file.name,
      fileSize: file.size,
    })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to parse file' }, 400)
  }
})

// ─── POST /validate — Validate mapped data ────────────────────────────────────

app.post('/validate', async (c) => {
  try {
    const body = await c.req.json()
    const { fileId, mapping, importType } = body
    const tenantId = c.get('tenantId') as string

    if (!fileId || !mapping || !importType) {
      return c.json({ error: 'Missing required fields: fileId, mapping, importType' }, 400)
    }

    const result = await validateMapping(fileId, mapping, importType, tenantId)
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message || 'Validation failed' }, 400)
  }
})

// ─── POST /execute — Run the import ───────────────────────────────────────────

app.post('/execute', async (c) => {
  try {
    const body = await c.req.json()
    const { fileId, mapping, importType, onConflict } = body
    const tenantId = c.get('tenantId') as string

    if (!fileId || !mapping || !importType) {
      return c.json({ error: 'Missing required fields: fileId, mapping, importType' }, 400)
    }

    const result = await executeImport(
      fileId,
      mapping,
      importType,
      tenantId,
      onConflict || 'skip'
    )

    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message || 'Import failed' }, 500)
  }
})

// ─── GET /history — List past imports ──────────────────────────────────────────

app.get('/history', async (c) => {
  try {
    try {
      const rows = await db.execute(
        `SELECT * FROM pricebook_import ORDER BY created_at DESC LIMIT 50`
      )
      return c.json({ history: rows })
    } catch {
      // Table may not exist yet
      return c.json({ history: [] })
    }
  } catch (err: any) {
    return c.json({ history: [] })
  }
})

// ─── GET /template/pricebook — Download pricebook CSV template ────────────────

app.get('/template/pricebook', (c) => {
  const buffer = generatePricebookTemplate()
  c.header('Content-Type', 'text/csv')
  c.header('Content-Disposition', 'attachment; filename="pricebook-template.csv"')
  return c.body(buffer)
})

// ─── GET /template/estimator — Download estimator CSV template ────────────────

app.get('/template/estimator', (c) => {
  const buffer = generateEstimatorTemplate()
  c.header('Content-Type', 'text/csv')
  c.header('Content-Disposition', 'attachment; filename="estimator-template.csv"')
  return c.body(buffer)
})

export default app
