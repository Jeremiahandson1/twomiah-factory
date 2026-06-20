import { Hono } from 'hono'
import selections from '../services/selections.ts'

const app = new Hono()

// Client portal routes - authenticated via portal token
// These are called from the customer-facing portal

/**
 * Get selections for client
 */
app.get('/project/:projectId/selections', async (c) => {
  const portal = c.get('portal') as any

  if (!portal?.contactId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const projectId = c.req.param('projectId')
  const data = await selections.getClientSelections(projectId, portal.contactId)
  return c.json(data)
})

/**
 * Client makes a selection
 */
app.post('/project/:projectId/selections/:selectionId', async (c) => {
  const portal = c.get('portal') as any

  if (!portal?.contactId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const projectId = c.req.param('projectId')
  const selectionId = c.req.param('selectionId')
  const { optionId, notes } = await c.req.json()

  if (!optionId) {
    return c.json({ error: 'Option ID is required' }, 400)
  }

  const result = await selections.clientMakeSelection(
    projectId,
    selectionId,
    portal.contactId,
    { optionId, notes }
  )

  return c.json(result)
})

export default app
