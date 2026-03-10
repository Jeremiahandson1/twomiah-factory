import { Hono } from 'hono';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../../db/index';
import { repProfile, user } from '../../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { authenticate, requireManager } from '../middleware/auth';
import { parseBody, emailSchema, nameSchema, phoneSchema, passwordSchema } from '../utils/validation';
import { NotFoundError, ConflictError } from '../utils/errors';
import { logger } from '../services/logger';

const app = new Hono();

app.use('*', authenticate);
app.use('*', requireManager);

// GET / — list rep profiles with user info
app.get('/', async (c) => {
  const authUser = c.get('user');

  const reps = await db
    .select({
      repProfile: repProfile,
      userEmail: user.email,
      userFirstName: user.firstName,
      userLastName: user.lastName,
      userPhone: user.phone,
      userIsActive: user.isActive,
    })
    .from(repProfile)
    .leftJoin(user, eq(repProfile.userId, user.id))
    .where(eq(repProfile.companyId, authUser.companyId))
    .orderBy(asc(user.lastName), asc(user.firstName));

  const formatted = reps.map((r) => ({
    ...(r.repProfile as any),
    email: r.userEmail,
    firstName: r.userFirstName,
    lastName: r.userLastName,
    phone: r.userPhone,
    userIsActive: r.userIsActive,
  }));

  return c.json({ reps: formatted });
});

// POST / — create rep profile (and user if needed)
const createRepSchema = z.object({
  email: emailSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: phoneSchema.optional().nullable(),
  password: passwordSchema.optional(),
  role: z.enum(['rep', 'senior_rep', 'manager', 'admin']).default('rep'),
  territoryId: z.string().optional().nullable(),
  maxDiscountPct: z.string().or(z.number()).transform(String).default('0'),
  commissionBasePct: z.string().or(z.number()).transform(String).default('0'),
  commissionBonusPct: z.string().or(z.number()).transform(String).default('0'),
  managerPin: z.string().optional().nullable(),
});

app.post('/', async (c) => {
  const authUser = c.get('user');
  const body = parseBody(createRepSchema, await c.req.json());

  // Check if user already exists
  let [existingUser] = await db
    .select()
    .from(user)
    .where(and(eq(user.email, body.email), eq(user.companyId, authUser.companyId)))
    .limit(1);

  let userId: string;

  if (existingUser) {
    userId = existingUser.id;

    // Check if rep profile already exists
    const [existingRep] = await db
      .select()
      .from(repProfile)
      .where(
        and(
          eq(repProfile.userId, userId),
          eq(repProfile.companyId, authUser.companyId)
        )
      )
      .limit(1);

    if (existingRep) {
      throw new ConflictError('Rep profile already exists for this user');
    }
  } else {
    // Create user
    userId = createId();
    const passwordHash = await Bun.password.hash(body.password || 'changeme123');

    await db.insert(user).values({
      id: userId,
      companyId: authUser.companyId,
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone || null,
      passwordHash,
      role: body.role,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Create rep profile
  const repId = createId();
  let hashedPin = null;
  if (body.managerPin && (body.role === 'manager' || body.role === 'admin')) {
    hashedPin = await Bun.password.hash(body.managerPin);
  }

  await db.insert(repProfile).values({
    id: repId,
    companyId: authUser.companyId,
    userId,
    role: body.role,
    territoryId: body.territoryId || null,
    maxDiscountPct: body.maxDiscountPct,
    commissionBasePct: body.commissionBasePct,
    commissionBonusPct: body.commissionBonusPct,
    managerPin: hashedPin,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  logger.info('Rep profile created', { repId, userId, email: body.email });

  return c.json({ id: repId, userId, message: 'Rep profile created' }, 201);
});

// PUT /:id — update rep profile
const updateRepSchema = z.object({
  role: z.enum(['rep', 'senior_rep', 'manager', 'admin']).optional(),
  territoryId: z.string().optional().nullable(),
  maxDiscountPct: z.string().or(z.number()).transform(String).optional(),
  commissionBasePct: z.string().or(z.number()).transform(String).optional(),
  commissionBonusPct: z.string().or(z.number()).transform(String).optional(),
  managerPin: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  // User fields
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  phone: phoneSchema.optional().nullable(),
});

app.put('/:id', async (c) => {
  const authUser = c.get('user');
  const repId = c.req.param('id');
  const body = parseBody(updateRepSchema, await c.req.json());

  const [existing] = await db
    .select()
    .from(repProfile)
    .where(
      and(eq(repProfile.id, repId), eq(repProfile.companyId, authUser.companyId))
    )
    .limit(1);

  if (!existing) throw new NotFoundError('Rep profile');

  // Update rep profile
  const repUpdates: Record<string, any> = { updatedAt: new Date() };
  if (body.role !== undefined) repUpdates.role = body.role;
  if (body.territoryId !== undefined) repUpdates.territoryId = body.territoryId;
  if (body.maxDiscountPct !== undefined) repUpdates.maxDiscountPct = body.maxDiscountPct;
  if (body.commissionBasePct !== undefined) repUpdates.commissionBasePct = body.commissionBasePct;
  if (body.commissionBonusPct !== undefined) repUpdates.commissionBonusPct = body.commissionBonusPct;
  if (body.isActive !== undefined) repUpdates.isActive = body.isActive;
  if (body.managerPin) {
    repUpdates.managerPin = await Bun.password.hash(body.managerPin);
  }

  await db.update(repProfile).set(repUpdates).where(eq(repProfile.id, repId));

  // Update user fields if provided
  const userUpdates: Record<string, any> = {};
  if (body.firstName !== undefined) userUpdates.firstName = body.firstName;
  if (body.lastName !== undefined) userUpdates.lastName = body.lastName;
  if (body.phone !== undefined) userUpdates.phone = body.phone;

  if (Object.keys(userUpdates).length > 0) {
    userUpdates.updatedAt = new Date();
    await db.update(user).set(userUpdates).where(eq(user.id, (existing as any).userId));
  }

  return c.json({ message: 'Rep profile updated' });
});

// DELETE /:id — deactivate
app.delete('/:id', async (c) => {
  const authUser = c.get('user');
  const repId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(repProfile)
    .where(
      and(eq(repProfile.id, repId), eq(repProfile.companyId, authUser.companyId))
    )
    .limit(1);

  if (!existing) throw new NotFoundError('Rep profile');

  await db
    .update(repProfile)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(repProfile.id, repId));

  return c.json({ message: 'Rep profile deactivated' });
});

export default app;
