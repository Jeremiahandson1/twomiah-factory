import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../db/index';
import { company } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { authenticate, requireManager } from '../middleware/auth';
import { parseBody } from '../utils/validation';
import { NotFoundError } from '../utils/errors';

const app = new Hono();

app.use('*', authenticate);

// GET /
app.get('/', async (c) => {
  const authUser = c.get('user');

  const [comp] = await db
    .select()
    .from(company)
    .where(eq(company.id, authUser.companyId))
    .limit(1);

  if (!comp) throw new NotFoundError('Company');

  const compData = comp as any;
  let settings = {};
  try {
    settings = compData.settings ? JSON.parse(compData.settings) : {};
  } catch {
    settings = {};
  }

  return c.json({
    company: {
      id: compData.id,
      name: compData.name,
      address: compData.address,
      phone: compData.phone,
      email: compData.email,
      logoUrl: compData.logoUrl,
      licenseNumber: compData.licenseNumber,
    },
    settings,
  });
});

// PUT /
const updateSettingsSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  licenseNumber: z.string().max(100).optional().nullable(),
  settings: z.record(z.any()).optional(),
});

app.put('/', requireManager, async (c) => {
  const authUser = c.get('user');
  const body = parseBody(updateSettingsSchema, await c.req.json());

  const [existing] = await db
    .select()
    .from(company)
    .where(eq(company.id, authUser.companyId))
    .limit(1);

  if (!existing) throw new NotFoundError('Company');

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.address !== undefined) updates.address = body.address;
  if (body.phone !== undefined) updates.phone = body.phone;
  if (body.email !== undefined) updates.email = body.email;
  if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl;
  if (body.licenseNumber !== undefined) updates.licenseNumber = body.licenseNumber;

  if (body.settings !== undefined) {
    // Merge with existing settings
    const existingData = existing as any;
    let currentSettings = {};
    try {
      currentSettings = existingData.settings ? JSON.parse(existingData.settings) : {};
    } catch {
      currentSettings = {};
    }
    updates.settings = JSON.stringify({ ...currentSettings, ...body.settings });
  }

  await db.update(company).set(updates).where(eq(company.id, authUser.companyId));

  return c.json({ message: 'Settings updated' });
});

export default app;
