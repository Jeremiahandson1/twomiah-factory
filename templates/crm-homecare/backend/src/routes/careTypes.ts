import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { careTypes } from '../../db/schema.ts'
import { eq, asc, count } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// Standard home-care service types. A fresh tenant had ZERO care types and no
// screen to create one, which blocked Add Rate (Care Type is required) and every
// client care-type dropdown. Seed a sensible default set on first read; the
// agency can rename/re-rate/deactivate or add their own.
const DEFAULT_CARE_TYPES = [
  { name: 'Personal Care', description: 'Bathing, dressing, grooming, toileting and mobility assistance.' },
  { name: 'Companion Care', description: 'Companionship, supervision, and social engagement.' },
  { name: 'Homemaker Services', description: 'Light housekeeping, meal prep, laundry and errands.' },
  { name: 'Respite Care', description: 'Temporary relief for family caregivers.' },
  { name: 'Skilled Nursing', description: 'Nursing services delivered by a licensed nurse.' },
  { name: 'Medication Management', description: 'Medication reminders and administration support.' },
]

async function ensureSeeded() {
  const [{ value }] = await db.select({ value: count() }).from(careTypes)
  if (Number(value) === 0) {
    await db.insert(careTypes).values(DEFAULT_CARE_TYPES)
  }
}

// GET / — list active care types (seeds standard defaults on first call)
app.get('/', async (c) => {
  try {
    await ensureSeeded()
    const rows = await db
      .select()
      .from(careTypes)
      .where(eq(careTypes.isActive, true))
      .orderBy(asc(careTypes.name))
    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST / — create a care type
app.post('/', async (c) => {
  try {
    const body = await c.req.json()
    if (!body.name || !String(body.name).trim()) {
      return c.json({ error: 'Name is required' }, 400)
    }
    const [row] = await db.insert(careTypes).values({
      name: String(body.name).trim(),
      description: body.description || null,
      hourlyRate: body.hourlyRate != null && body.hourlyRate !== '' ? String(body.hourlyRate) : null,
    }).returning()
    return c.json(row, 201)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// PUT /:id — update
app.put('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const updates: any = { }
    if (body.name !== undefined) updates.name = String(body.name).trim()
    if (body.description !== undefined) updates.description = body.description || null
    if (body.hourlyRate !== undefined) updates.hourlyRate = body.hourlyRate != null && body.hourlyRate !== '' ? String(body.hourlyRate) : null
    if (body.isActive !== undefined) updates.isActive = !!body.isActive
    const [row] = await db.update(careTypes).set(updates).where(eq(careTypes.id, id)).returning()
    if (!row) return c.json({ error: 'Care type not found' }, 404)
    return c.json(row)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// DELETE /:id — soft delete (deactivate)
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    await db.update(careTypes).set({ isActive: false }).where(eq(careTypes.id, id))
    return c.json({ message: 'Deactivated' })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
