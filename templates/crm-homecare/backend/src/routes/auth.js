import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate, logAuthEvent } from '../middleware/auth.js';
import logger from '../services/logger.js';

const router = Router();

const generateTokens = (userId, email, role) => {
  const accessToken = jwt.sign({ userId, email, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId, type: 'refresh' }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
};

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  const ip = req.ip;
  const ua = req.headers['user-agent'];
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

    if (!user) {
      await logAuthEvent(prisma, { email, success: false, ipAddress: ip, userAgent: ua, failReason: 'user_not_found' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      await logAuthEvent(prisma, { email, userId: user.id, success: false, ipAddress: ip, userAgent: ua, failReason: 'account_inactive' });
      return res.status(401).json({ error: 'Account is inactive' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await logAuthEvent(prisma, { email, userId: user.id, success: false, ipAddress: ip, userAgent: ua, failReason: 'invalid_password' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.email, user.role);

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date(), refreshToken } });
    await logAuthEvent(prisma, { email, userId: user.id, success: true, ipAddress: ip, userAgent: ua });

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
    });
  } catch (err) { next(err); }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user || !user.isActive || user.refreshToken !== refreshToken) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const tokens = generateTokens(user.id, user.email, user.role);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: tokens.refreshToken } });

    res.json(tokens);
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.user.userId }, data: { refreshToken: null } });
    res.json({ message: 'Logged out' });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true,
        role: true, isActive: true, hireDate: true, defaultPayRate: true,
        certifications: true, certificationsExpiry: true, lastLogin: true,
        profile: { select: { npiNumber: true, taxonomyCode: true, evvWorkerId: true, medicaidProviderId: true } },
      },
    });
    res.json(user);
  } catch (err) { next(err); }
});

// PUT /api/auth/change-password
router.put('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.userId }, data: { passwordHash } });
    res.json({ message: 'Password changed successfully' });
  } catch (err) { next(err); }
});

export default router;
