/**
 * Routes for the remaining competitive gap features (online booking lives in routes/booking.ts):
 * 2. Job Costing
 * 3. Custom Forms
 * 4. Lien Waivers
 * 5. Draw Schedules
 */

import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import jobCosting from '../services/jobCosting.ts'
import customForms from '../services/customForms.ts'
import lienWaivers from '../services/lienWaivers.ts'
import drawSchedules from '../services/drawSchedules.ts'

// ============================================
// 2. JOB COSTING
// ============================================
export const jobCostingRoutes = new Hono()
jobCostingRoutes.use('*', authenticate)

jobCostingRoutes.get('/job/:jobId', async (c) => {
  const user = c.get('user') as any
  const jobId = c.req.param('jobId')
  const analysis = await jobCosting.getJobCostAnalysis(jobId, user.companyId)
  return c.json(analysis)
})

jobCostingRoutes.get('/report', async (c) => {
  const user = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const status = c.req.query('status')
  const limit = c.req.query('limit')
  const report = await jobCosting.getJobCostingReport(user.companyId, { startDate, endDate, status, limit: +(limit || 0) || 100 })
  return c.json(report)
})

jobCostingRoutes.get('/trends', async (c) => {
  const user = c.get('user') as any
  const months = c.req.query('months')
  const trends = await jobCosting.getProfitabilityTrends(user.companyId, { months: +(months || 0) || 12 })
  return c.json(trends)
})

// ============================================
// 3. CUSTOM FORMS
// ============================================
export const customFormsRoutes = new Hono()
customFormsRoutes.use('*', authenticate)

// Templates
customFormsRoutes.get('/templates', async (c) => {
  const user = c.get('user') as any
  const category = c.req.query('category')
  const templates = await customForms.getFormTemplates(user.companyId, { category })
  return c.json(templates)
})

customFormsRoutes.get('/templates/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const template = await customForms.getFormTemplate(id, user.companyId)
  if (!template) return c.json({ error: 'Not found' }, 404)
  return c.json(template)
})

customFormsRoutes.post('/templates', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const template = await customForms.createFormTemplate(user.companyId, body)
  return c.json(template, 201)
})

customFormsRoutes.put('/templates/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await customForms.updateFormTemplate(id, user.companyId, body)
  return c.json({ success: true })
})

customFormsRoutes.post('/templates/seed-defaults', async (c) => {
  const user = c.get('user') as any
  await customForms.seedDefaultTemplates(user.companyId)
  return c.json({ success: true })
})

// Submissions
customFormsRoutes.get('/submissions', async (c) => {
  const user = c.get('user') as any
  const jobId = c.req.query('jobId')
  const projectId = c.req.query('projectId')
  const templateId = c.req.query('templateId')
  const submissions = await customForms.getSubmissions(user.companyId, { jobId, projectId, templateId })
  return c.json(submissions)
})

customFormsRoutes.get('/submissions/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const submission = await customForms.getSubmission(id, user.companyId)
  if (!submission) return c.json({ error: 'Not found' }, 404)
  return c.json(submission)
})

customFormsRoutes.post('/submissions', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const submission = await customForms.submitForm(user.companyId, {
    ...body,
    submittedById: user.userId,
  })
  return c.json(submission, 201)
})

// ============================================
// 4. LIEN WAIVERS
// ============================================
export const lienWaiverRoutes = new Hono()
lienWaiverRoutes.use('*', authenticate)

lienWaiverRoutes.get('/', async (c) => {
  const user = c.get('user') as any
  const status = c.req.query('status')
  const projectId = c.req.query('projectId')
  const page = c.req.query('page')
  const limit = c.req.query('limit')
  const waivers = await lienWaivers.getAllWaivers(user.companyId, { status, projectId, page: +(page || 0) || 1, limit: +(limit || 0) || 50 })
  return c.json(waivers)
})

lienWaiverRoutes.get('/project/:projectId', async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const status = c.req.query('status')
  const vendorId = c.req.query('vendorId')
  const waivers = await lienWaivers.getProjectWaivers(projectId, user.companyId, { status, vendorId })
  return c.json(waivers)
})

lienWaiverRoutes.get('/project/:projectId/compliance', async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const compliance = await lienWaivers.getProjectCompliance(projectId, user.companyId)
  return c.json(compliance)
})

lienWaiverRoutes.get('/outstanding', async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.query('projectId')
  const outstanding = await lienWaivers.getOutstandingWaivers(user.companyId, { projectId })
  return c.json(outstanding)
})

lienWaiverRoutes.post('/', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const waiver = await lienWaivers.createWaiverRequest(user.companyId, body)
  return c.json(waiver, 201)
})

lienWaiverRoutes.put('/:id/upload', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await lienWaivers.uploadSignedWaiver(id, user.companyId, body)
  return c.json({ success: true })
})

lienWaiverRoutes.put('/:id/approve', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await lienWaivers.approveWaiver(id, user.companyId, {
    approvedById: user.id,
    notes: body.notes,
  })
  return c.json({ success: true })
})

lienWaiverRoutes.put('/:id/reject', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await lienWaivers.rejectWaiver(id, user.companyId, {
    rejectedById: user.id,
    reason: body.reason,
  })
  return c.json({ success: true })
})

// ============================================
// 5. DRAW SCHEDULES
// ============================================
export const drawScheduleRoutes = new Hono()
drawScheduleRoutes.use('*', authenticate)

// Schedule of Values
drawScheduleRoutes.get('/sov/:projectId', async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const sov = await drawSchedules.getScheduleOfValues(projectId, user.companyId)
  return c.json(sov)
})

drawScheduleRoutes.post('/sov', async (c) => {
  const user = c.get('user') as any
  const { projectId, ...data } = await c.req.json()
  const sov = await drawSchedules.createScheduleOfValues(user.companyId, projectId, data)
  return c.json(sov, 201)
})

drawScheduleRoutes.put('/sov/line-item/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await drawSchedules.updateSOVLineItem(id, user.companyId, body)
  return c.json({ success: true })
})

drawScheduleRoutes.post('/sov/:sovId/line-item', async (c) => {
  const user = c.get('user') as any
  const sovId = c.req.param('sovId')
  const body = await c.req.json()
  const item = await drawSchedules.addSOVLineItem(sovId, user.companyId, body)
  return c.json(item, 201)
})

// Draw Requests
drawScheduleRoutes.get('/project/:projectId', async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.param('projectId')
  const draws = await drawSchedules.getProjectDraws(projectId, user.companyId)
  return c.json(draws)
})

drawScheduleRoutes.get('/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const draw = await drawSchedules.getDrawRequest(id, user.companyId)
  if (!draw) return c.json({ error: 'Not found' }, 404)
  return c.json(draw)
})

drawScheduleRoutes.post('/', async (c) => {
  const user = c.get('user') as any
  const { sovId, ...data } = await c.req.json()
  const draw = await drawSchedules.createDrawRequest(user.companyId, sovId, data)
  return c.json(draw, 201)
})

drawScheduleRoutes.put('/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await drawSchedules.updateDrawRequest(id, user.companyId, body)
  return c.json({ success: true })
})

drawScheduleRoutes.post('/:id/submit', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const draw = await drawSchedules.submitDrawRequest(id, user.companyId)
  return c.json(draw)
})

drawScheduleRoutes.post('/:id/approve', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const draw = await drawSchedules.approveDrawRequest(id, user.companyId, {
    approvedById: user.id,
    notes: body.notes,
  })
  return c.json(draw)
})

drawScheduleRoutes.post('/:id/reject', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await drawSchedules.rejectDrawRequest(id, user.companyId, {
    rejectedById: user.id,
    reason: body.reason,
  })
  return c.json({ success: true })
})

// G702/G703 generation
drawScheduleRoutes.get('/:id/g702', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const data = await drawSchedules.generateG702Data(id, user.companyId)
  return c.json(data)
})

drawScheduleRoutes.get('/:id/g703', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const data = await drawSchedules.generateG703Data(id, user.companyId)
  return c.json(data)
})

const app = new Hono()
app.route('/job-costing', jobCostingRoutes)
app.route('/forms', customFormsRoutes)
app.route('/lien-waivers', lienWaiverRoutes)
app.route('/draws', drawScheduleRoutes)

export default app
