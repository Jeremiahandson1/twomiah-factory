import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';
import emailService from '../services/email.js';
import logger from '../services/logger.js';

const router = Router();

const generateTokens = (userId, companyId, email, role) => {
  const accessToken = jwt.sign({ userId, companyId, email, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId, companyId, type: 'refresh' }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
};

// Feature sets for each plan tier
const PLAN_FEATURES = {
  starter: [
    'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
    'time_tracking', 'expenses', 'documents', 'customer_portal', 'dashboard', 'mobile_app',
  ],
  pro: [
    'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
    'time_tracking', 'expenses', 'documents', 'customer_portal', 'dashboard', 'mobile_app',
    'team_management', 'sms', 'sms_templates', 'gps_tracking', 'geofencing', 'auto_clock',
    'route_optimization', 'online_booking', 'review_requests', 'service_agreements',
    'pricebook', 'quickbooks_sync', 'recurring_jobs', 'job_costing',
  ],
  business: [
    'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
    'time_tracking', 'expenses', 'documents', 'customer_portal', 'dashboard', 'mobile_app',
    'team_management', 'sms', 'sms_templates', 'scheduled_sms', 'gps_tracking', 'geofencing',
    'auto_clock', 'route_optimization', 'online_booking', 'review_requests', 'service_agreements',
    'pricebook', 'quickbooks_sync', 'recurring_jobs', 'job_costing', 'inventory',
    'inventory_locations', 'stock_levels', 'inventory_transfers', 'purchase_orders',
    'equipment_tracking', 'equipment_maintenance', 'fleet_vehicles', 'fleet_maintenance',
    'fleet_fuel', 'warranties', 'warranty_claims', 'email_templates', 'email_campaigns',
    'call_tracking', 'automations', 'custom_forms', 'consumer_financing', 'advanced_reporting',
  ],
  construction: [
    'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
    'time_tracking', 'expenses', 'documents', 'customer_portal', 'dashboard', 'mobile_app',
    'team_management', 'sms', 'sms_templates', 'scheduled_sms', 'gps_tracking', 'geofencing',
    'auto_clock', 'route_optimization', 'online_booking', 'review_requests', 'service_agreements',
    'pricebook', 'quickbooks_sync', 'recurring_jobs', 'job_costing', 'inventory',
    'inventory_locations', 'stock_levels', 'inventory_transfers', 'purchase_orders',
    'equipment_tracking', 'equipment_maintenance', 'fleet_vehicles', 'fleet_maintenance',
    'fleet_fuel', 'warranties', 'warranty_claims', 'email_templates', 'email_campaigns',
    'call_tracking', 'automations', 'custom_forms', 'consumer_financing', 'advanced_reporting',
    'projects', 'project_budgets', 'project_phases', 'change_orders', 'rfis', 'submittals',
    'daily_logs', 'punch_lists', 'inspections', 'bids', 'gantt_charts', 'selections',
    'selection_portal', 'takeoffs', 'lien_waivers', 'draw_schedules', 'draw_requests', 'aia_forms',
  ],
  enterprise: ['all'],
};

// Plan limits
const PLAN_LIMITS = {
  starter: { users: 2, contacts: 500, jobs: 100, storage: 5 },
  pro: { users: 5, contacts: 2500, jobs: 500, storage: 25 },
  business: { users: 15, contacts: 10000, jobs: 2000, storage: 100 },
  construction: { users: 20, contacts: 25000, jobs: 5000, storage: 250 },
  enterprise: { users: null, contacts: null, jobs: null, storage: null },
};

// Self-serve signup (multi-step flow)
router.post('/signup', async (req, res, next) => {
  try {
    const schema = z.object({
      // Company
      companyName: z.string().min(1),
      industry: z.string().min(1),
      phone: z.string().min(1),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
      website: z.string().optional(),
      employeeCount: z.string().optional(),
      
      // User
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(8),
      
      // Plan
      plan: z.enum(['starter', 'pro', 'business', 'construction', 'enterprise']),
      billingCycle: z.enum(['monthly', 'annual']),
    });
    
    const data = schema.parse(req.body);

    // Check if email already exists
    const existing = await prisma.user.findFirst({ where: { email: data.email } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Generate unique company slug
    const baseSlug = data.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const slug = `${baseSlug}-${uuidv4().substring(0, 6)}`;
    
    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 12);
    
    // Get features for the selected plan
    const enabledFeatures = PLAN_FEATURES[data.plan] || PLAN_FEATURES.starter;
    const limits = PLAN_LIMITS[data.plan] || PLAN_LIMITS.starter;
    
    // Calculate trial end date (14 days)
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    // Create company and user in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create company
      const company = await tx.company.create({
        data: {
          name: data.companyName,
          slug,
          email: data.email,
          phone: data.phone,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
          website: data.website,
          industry: data.industry,
          enabledFeatures,
          settings: {
            plan: data.plan,
            billingCycle: data.billingCycle,
            employeeCount: data.employeeCount,
            limits,
            trialEndsAt: trialEndsAt.toISOString(),
            subscriptionStatus: 'trialing',
          },
        },
      });

      // Create owner user
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          role: 'owner',
          companyId: company.id,
        },
      });

      // Create subscription record
      await tx.subscription.create({
        data: {
          companyId: company.id,
          plan: data.plan,
          status: 'trialing',
          currentPeriodStart: new Date(),
          currentPeriodEnd: trialEndsAt,
          cancelAtPeriodEnd: false,
        },
      });

      return { company, user };
    });

    // Generate auth token
    const token = jwt.sign(
      {
        userId: result.user.id,
        companyId: result.company.id,
        email: result.user.email,
        role: result.user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Send welcome email
    try {
      await emailService.sendWelcomeEmail(data.email, {
        firstName: data.firstName,
        companyName: data.companyName,
        plan: data.plan,
        trialEndsAt,
      });
    } catch (emailErr) {
      logger.logError(emailErr, null, { action: 'sendWelcomeEmail', email: data.email });
    }

    logger.info('New signup', {
      companyId: result.company.id,
      plan: data.plan,
      industry: data.industry,
    });

    res.status(201).json({
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
      },
      company: {
        id: result.company.id,
        name: result.company.name,
        slug: result.company.slug,
        enabledFeatures: result.company.enabledFeatures,
        plan: data.plan,
        trialEndsAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Legacy register endpoint (keep for backwards compatibility)
router.post('/register', async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      companyName: z.string().min(1),
      phone: z.string().optional(),
    });
    const data = schema.parse(req.body);

    const existing = await prisma.user.findFirst({ where: { email: data.email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const slug = data.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + uuidv4().substring(0, 6);
    const passwordHash = await bcrypt.hash(data.password, 12);

    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: data.companyName,
          slug,
          email: data.email,
          phone: data.phone,
          enabledFeatures: ['contacts', 'projects', 'jobs', 'quotes', 'invoices', 'scheduling', 'team'],
        },
      });
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          role: 'owner', // Company creator is owner
          companyId: company.id,
        },
      });
      return { company, user };
    });

    const tokens = generateTokens(result.user.id, result.company.id, result.user.email, result.user.role);
    await prisma.user.update({ where: { id: result.user.id }, data: { refreshToken: tokens.refreshToken } });

    res.status(201).json({
      user: { id: result.user.id, email: result.user.email, firstName: result.user.firstName, lastName: result.user.lastName, role: result.user.role },
      company: { id: result.company.id, name: result.company.name, slug: result.company.slug, enabledFeatures: result.company.enabledFeatures },
      ...tokens,
    });
  } catch (error) { next(error); }
});

// Login
router.post('/login', async (req, res, next) => {
  try {
    const schema = z.object({ email: z.string().email(), password: z.string() });
    const data = schema.parse(req.body);

    const user = await prisma.user.findFirst({ where: { email: data.email }, include: { company: true } });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.isActive) return res.status(401).json({ error: 'Account is disabled' });

    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const tokens = generateTokens(user.id, user.companyId, user.email, user.role);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: tokens.refreshToken, lastLogin: new Date() } });

    res.json({
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, avatar: user.avatar },
      company: { id: user.company.id, name: user.company.name, slug: user.company.slug, logo: user.company.logo, primaryColor: user.company.primaryColor, enabledFeatures: user.company.enabledFeatures },
      ...tokens,
    });
  } catch (error) { next(error); }
});

// Refresh token
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' });

    let decoded;
    try { decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET); }
    catch { return res.status(401).json({ error: 'Invalid refresh token' }); }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.isActive || user.refreshToken !== refreshToken) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const tokens = generateTokens(user.id, user.companyId, user.email, user.role);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: tokens.refreshToken } });

    res.json(tokens);
  } catch (error) { next(error); }
});

// Logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.user.userId }, data: { refreshToken: null } });
    res.json({ message: 'Logged out' });
  } catch (error) { next(error); }
});

// Get current user
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, include: { company: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Import permissions
    const { getPermissions, normalizeRole } = await import('../middleware/permissions.js');
    const permissions = getPermissions(user.role);

    res.json({
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone, role: normalizeRole(user.role), avatar: user.avatar },
      company: { id: user.company.id, name: user.company.name, slug: user.company.slug, logo: user.company.logo, primaryColor: user.company.primaryColor, enabledFeatures: user.company.enabledFeatures, settings: user.company.settings },
      permissions,
    });
  } catch (error) { next(error); }
});

// Get user permissions
router.get('/permissions', authenticate, async (req, res, next) => {
  try {
    const { getPermissions, normalizeRole, hasPermission, ROLE_HIERARCHY } = await import('../middleware/permissions.js');
    const role = normalizeRole(req.user.role);
    const permissions = getPermissions(role);
    
    res.json({
      role,
      roleLevel: ROLE_HIERARCHY.indexOf(role),
      permissions,
      // Helper: check common permissions
      can: {
        manageTeam: hasPermission(role, 'team:create'),
        manageFinancials: hasPermission(role, 'invoices:create'),
        approveTime: hasPermission(role, 'time:approve'),
        deleteCompany: hasPermission(role, 'company:delete'),
      },
    });
  } catch (error) { next(error); }
});

// Change password
router.put('/password', authenticate, async (req, res, next) => {
  try {
    const schema = z.object({ currentPassword: z.string(), newPassword: z.string().min(8) });
    const data = schema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    const valid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

    const passwordHash = await bcrypt.hash(data.newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    res.json({ message: 'Password changed successfully' });
  } catch (error) { next(error); }
});

// Forgot password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findFirst({ where: { email } });
    
    if (user) {
      const resetToken = uuidv4();
      const resetCode = Math.random().toString().substring(2, 8); // 6-digit code
      
      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExp: new Date(Date.now() + 3600000) },
      });
      
      // Send email
      try {
        await emailService.sendPasswordReset(email, {
          firstName: user.firstName,
          resetToken,
          resetCode,
        });
        logger.info('Password reset email sent', { email });
      } catch (emailErr) {
        logger.logError(emailErr, null, { action: 'sendPasswordResetEmail', email });
      }
    }

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (error) { next(error); }
});

// Reset password
router.post('/reset-password', async (req, res, next) => {
  try {
    const schema = z.object({ token: z.string(), password: z.string().min(8) });
    const data = schema.parse(req.body);

    const user = await prisma.user.findFirst({
      where: { resetToken: data.token, resetTokenExp: { gt: new Date() } },
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

    const passwordHash = await bcrypt.hash(data.password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExp: null },
    });

    res.json({ message: 'Password reset successfully' });
  } catch (error) { next(error); }
});

export default router;
