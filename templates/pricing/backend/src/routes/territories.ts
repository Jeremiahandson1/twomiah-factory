import { Hono } from 'hono';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../../db/index';
import { territory } from '../../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { authenticate, requireManager } from '../middleware/auth';
import { parseBody, nameSchema } from '../utils/validation';
import { NotFoundError } from '../utils/errors';

const app = new Hono();

app.use('*', authenticate);
app.use('*', requireManager);

// GET /
app.get('/', async (c) => {
  const authUser = c.get('user');

  const territories = await db
    .select()
    .from(territory)
    .where(eq(territory.companyId, authUser.companyId))
    .orderBy(asc(territory.name));

  return c.json({ territories });
});

// POST /
const createTerritorySchema = z.object({
  name: nameSchema,
  description: z.string().max(1000).optional().nullable(),
  region: z.string().max(255).optional().nullable(),
  zipCodes: z.array(z.string()).optional().nullable(),
});

app.post('/', async (c) => {
  const authUser = c.get('user');
  const body = parseBody(createTerritorySchema, await c.req.json());

  const id = createId();
  await db.insert(territory).values({
    id,
    companyId: authUser.companyId,
    name: body.name,
    description: body.description || null,
    region: body.region || null,
    zipCodes: body.zipCodes ? JSON.stringify(body.zipCodes) : null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.json({ id, message: 'Territory created' }, 201);
});

// PUT /:id
const updateTerritorySchema = z.object({
  name: nameSchema.optional(),
  description: z.string().max(1000).optional().nullable(),
  region: z.string().max(255).optional().nullable(),
  zipCodes: z.array(z.string()).optional().nullable(),
  isActive: z.boolean().optional(),
});

app.put('/:id', async (c) => {
  const authUser = c.get('user');
  const territoryId = c.req.param('id');
  const body = parseBody(updateTerritorySchema, await c.req.json());

  const [existing] = await db
    .select()
    .from(territory)
    .where(and(eq(territory.id, territoryId), eq(territory.companyId, authUser.companyId)))
    .limit(1);

  if (!existing) throw new NotFoundError('Territory');

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.region !== undefined) updates.region = body.region;
  if (body.zipCodes !== undefined) updates.zipCodes = body.zipCodes ? JSON.stringify(body.zipCodes) : null;
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  await db.update(territory).set(updates).where(eq(territory.id, territoryId));

  return c.json({ message: 'Territory updated' });
});

// DELETE /:id (deactivate)
app.delete('/:id', async (c) => {
  const authUser = c.get('user');
  const territoryId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(territory)
    .where(and(eq(territory.id, territoryId), eq(territory.companyId, authUser.companyId)))
    .limit(1);

  if (!existing) throw new NotFoundError('Territory');

  await db
    .update(territory)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(territory.id, territoryId));

  return c.json({ message: 'Territory deactivated' });
});

export default app;
