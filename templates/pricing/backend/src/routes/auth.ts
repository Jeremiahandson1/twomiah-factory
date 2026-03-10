import { Hono } from 'hono';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { db } from '../../db/index';
import { user, repProfile } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { authenticate } from '../middleware/auth';
import { parseBody, emailSchema, passwordSchema, nameSchema, phoneSchema } from '../utils/validation';
import { AppError } from '../utils/errors';
import { logger } from '../services/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

const app = new Hono();

// POST /login
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

app.post('/login', async (c) => {
  const body = parseBody(loginSchema, await c.req.json());

  const [userRecord] = await db
    .select()
    .from(user)
    .where(eq(user.email, body.email))
    .limit(1);

  if (!userRecord) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const u = userRecord as any;
  if (!u.isActive) {
    return c.json({ error: 'Account is deactivated' }, 401);
  }

  // Verify password using Bun's built-in bcrypt-compatible hasher
  const passwordValid = await Bun.password.verify(body.password, u.passwordHash);
  if (!passwordValid) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  // Get rep profile if exists
  const [rep] = await db
    .select()
    .from(repProfile)
    .where(and(eq(repProfile.userId, u.id), eq(repProfile.companyId, u.companyId)))
    .limit(1);

  const role = rep ? (rep as any).role : u.role || 'admin';

  const tokenPayload = {
    userId: u.id,
    companyId: u.companyId,
    email: u.email,
    role,
  };

  const accessToken = jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  } as any);

  const refreshToken = jwt.sign(
    { userId: u.id, companyId: u.companyId, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN } as any
  );

  logger.info('User logged in', { userId: u.id, email: u.email });

  return c.json({
    accessToken,
    refreshToken,
    user: {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role,
      companyId: u.companyId,
      repProfileId: rep ? rep.id : null,
    },
  });
});

// POST /refresh
const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

app.post('/refresh', async (c) => {
  const body = parseBody(refreshSchema, await c.req.json());

  try {
    const payload = jwt.verify(body.refreshToken, JWT_SECRET) as any;

    if (payload.type !== 'refresh') {
      return c.json({ error: 'Invalid refresh token' }, 401);
    }

    const [userRecord] = await db
      .select()
      .from(user)
      .where(eq(user.id, payload.userId))
      .limit(1);

    if (!userRecord || !(userRecord as any).isActive) {
      return c.json({ error: 'User not found or deactivated' }, 401);
    }

    const u = userRecord as any;

    const [rep] = await db
      .select()
      .from(repProfile)
      .where(and(eq(repProfile.userId, u.id), eq(repProfile.companyId, u.companyId)))
      .limit(1);

    const role = rep ? (rep as any).role : u.role || 'admin';

    const accessToken = jwt.sign(
      { userId: u.id, companyId: u.companyId, email: u.email, role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as any
    );

    const newRefreshToken = jwt.sign(
      { userId: u.id, companyId: u.companyId, type: 'refresh' },
      JWT_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN } as any
    );

    return c.json({ accessToken, refreshToken: newRefreshToken });
  } catch {
    return c.json({ error: 'Invalid or expired refresh token' }, 401);
  }
});

// GET /me
app.get('/me', authenticate, async (c) => {
  const authUser = c.get('user');

  const [userRecord] = await db
    .select()
    .from(user)
    .where(eq(user.id, authUser.userId))
    .limit(1);

  if (!userRecord) {
    return c.json({ error: 'User not found' }, 404);
  }

  const u = userRecord as any;
  let rep = null;
  if (authUser.repProfileId) {
    const [repRecord] = await db
      .select()
      .from(repProfile)
      .where(eq(repProfile.id, authUser.repProfileId))
      .limit(1);
    rep = repRecord || null;
  }

  return c.json({
    user: {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      role: authUser.role,
      companyId: u.companyId,
    },
    repProfile: rep
      ? {
          id: (rep as any).id,
          role: (rep as any).role,
          territoryId: (rep as any).territoryId,
          maxDiscountPct: (rep as any).maxDiscountPct,
          commissionBasePct: (rep as any).commissionBasePct,
          commissionBonusPct: (rep as any).commissionBonusPct,
        }
      : null,
  });
});

// PUT /me
const updateProfileSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  phone: phoneSchema.optional().nullable(),
});

app.put('/me', authenticate, async (c) => {
  const authUser = c.get('user');
  const body = parseBody(updateProfileSchema, await c.req.json());

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.firstName !== undefined) updates.firstName = body.firstName;
  if (body.lastName !== undefined) updates.lastName = body.lastName;
  if (body.phone !== undefined) updates.phone = body.phone;

  await db.update(user).set(updates).where(eq(user.id, authUser.userId));

  return c.json({ message: 'Profile updated' });
});

// POST /change-password
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

app.post('/change-password', authenticate, async (c) => {
  const authUser = c.get('user');
  const body = parseBody(changePasswordSchema, await c.req.json());

  const [userRecord] = await db
    .select()
    .from(user)
    .where(eq(user.id, authUser.userId))
    .limit(1);

  if (!userRecord) {
    return c.json({ error: 'User not found' }, 404);
  }

  const u = userRecord as any;
  const valid = await Bun.password.verify(body.currentPassword, u.passwordHash);
  if (!valid) {
    return c.json({ error: 'Current password is incorrect' }, 400);
  }

  const newHash = await Bun.password.hash(body.newPassword);
  await db.update(user).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(user.id, authUser.userId));

  logger.info('Password changed', { userId: authUser.userId });
  return c.json({ message: 'Password changed successfully' });
});

export default app;
