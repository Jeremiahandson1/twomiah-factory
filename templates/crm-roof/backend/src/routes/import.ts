import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import importService, { type FileUpload } from '../services/import.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// Preview a single CSV (detect type, show columns + sample rows)
app.post('/preview', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file uploaded' }, 400)

  const content = await file.text()
  const preview = importService.previewCSV(content)

  return c.json({ ...preview, filename: file.name })
})

// Run full multi-file import with cross-referencing
app.post('/run', async (c) => {
  const currentUser = c.get('user') as any
  const formData = await c.req.formData()

  const dryRun = formData.get('dryRun') === 'true'
  const createMissingContacts = formData.get('createMissingContacts') !== 'false'

  // Collect all uploaded files
  const files: FileUpload[] = []
  const entries = formData.getAll('files')

  for (const entry of entries) {
    if (entry instanceof File) {
      const content = await entry.text()
      const detectedType = importService.detectCSVType(content)
      files.push({ name: entry.name, content, detectedType })
    }
  }

  // Also support individual file fields (clients, jobs)
  const clientsFile = formData.get('clients') as File | null
  if (clientsFile) {
    const content = await clientsFile.text()
    files.push({ name: clientsFile.name, content, detectedType: 'clients' })
  }

  const jobsFile = formData.get('jobs') as File | null
  if (jobsFile) {
    const content = await jobsFile.text()
    files.push({ name: jobsFile.name, content, detectedType: 'jobs' })
  }

  if (files.length === 0) {
    return c.json({ error: 'No files uploaded' }, 400)
  }

  // Validate all files could be detected
  const unknowns = files.filter(f => f.detectedType === 'unknown')
  if (unknowns.length > 0 && files.length === unknowns.length) {
    return c.json({
      error: 'Could not detect CSV type for any uploaded file',
      files: unknowns.map(f => f.name),
    }, 400)
  }

  const result = await importService.runImport(files, currentUser.companyId, {
    dryRun,
    createMissingContacts,
  })

  return c.json({
    dryRun,
    files: files.map(f => ({ name: f.name, type: f.detectedType })),
    ...result,
  })
})

export default app
