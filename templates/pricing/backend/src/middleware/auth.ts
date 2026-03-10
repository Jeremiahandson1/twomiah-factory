import { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';
import { db } from '../../db/index';
import { user, repProfile } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../services/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

export interface AuthUser {
  userId: string;
  companyId: string;
  email: string;
  role: string;
  repProfileId: string | null;
  maxDiscountPct: number;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export const authenticate = async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      companyId: string;
      email: string;
      role: string;
    };

    // Lookup the user record
    const [userRecord] = await db
      .select()
      .from(user)
      .where(and(eq(user.id, payload.userId), eq(user.companyId, payload.companyId)))
      .limit(1);

    if (!userRecord) {
      return c.json({ error: 'User not found' }, 401);
    }

    if (!(userRecord as any).isActive) {
      return c.json({ error: 'Account is deactivated' }, 401);
    }

    // Lookup rep profile if exists
    const [rep] = await db
      .select()
      .from(repProfile)
      .where(and(eq(repProfile.userId, payload.userId), eq(repProfile.companyId, payload.companyId)))
      .limit(1);

    const role = rep ? (rep as any).role : (userRecord as any).role || payload.role;

    // Max discount based on role
    let maxDiscountPct = 0;
    if (rep) {
      maxDiscountPct = parseFloat((rep as any).maxDiscountPct || '0');
    } else {
      // Admins/managers without rep profile get full authority
      if (role === 'admin' || role === 'manager') {
        maxDiscountPct = 100;
      }
    }

    const authUser: AuthUser = {
      userId: payload.userId,
      companyId: payload.companyId,
      email: payload.email,
      role,
      repProfileId: rep ? rep.id : null,
      maxDiscountPct,
    };

    c.set('user', authUser);
    await next();
  } catch (err) {
    if ((err as any).name === 'TokenExpiredError') {
      return c.json({ error: 'Token expired' }, 401);
    }
    if ((err as any).name === 'JsonWebTokenError') {
      return c.json({ error: 'Invalid token' }, 401);
    }
    logger.error('Auth middleware error', { error: (err as Error).message });
    return c.json({ error: 'Authentication failed' }, 401);
  }
};

export const requireRole =
  (...roles: string[]) =>
  async (c: Context, next: Next) => {
    const u = c.get('user');
    if (!u) {
      return c.json({ error: 'Not authenticated' }, 401);
    }
    if (!roles.includes(u.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    await next();
  };

export const requireAdmin = requireRole('admin');
export const requireManager = requireRole('admin', 'manager');
