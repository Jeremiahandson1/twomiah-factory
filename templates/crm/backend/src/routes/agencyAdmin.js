/**
 * Agency Admin Routes
 * 
 * API for managing customer CRM deployments:
 * - Create new customer with selected features
 * - Update customer features
 * - View all customers
 * - Delete customer
 */

import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';
import { 
  FEATURE_REGISTRY, 
  FEATURE_PACKAGES,
  getCoreFeatureIds,
  getPackageFeatures,
  getAllFeatureIds,
} from '../config/featureRegistry.js';

const router = Router();

// Only agency admins can access these routes
const requireAgencyAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'agency_admin') {
    return res.status(403).json({ error: 'Agency admin access required' });
  }
  next();
};

router.use(authenticate);
router.use(requireAgencyAdmin);

// ============================================
// FEATURE REGISTRY (read-only)
// ============================================

/**
 * Get all available features (for the checkbox UI)
 */
router.get('/features', (req, res) => {
  res.json({
    registry: FEATURE_REGISTRY,
    packages: FEATURE_PACKAGES,
    coreFeatures: getCoreFeatureIds(),
  });
});

// ============================================
// CUSTOMER MANAGEMENT
// ============================================

const createCustomerSchema = z.object({
  // Company info
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/).optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  
  // Address
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  
  // Branding
  logo: z.string().url().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  
  // Features
  packageId: z.string().optional(), // Use preset package
  enabledFeatures: z.array(z.string()).optional(), // OR pick individual features
  
  // Admin user for the new company
  adminEmail: z.string().email(),
  adminFirstName: z.string().min(1),
  adminLastName: z.string().min(1),
  adminPassword: z.string().min(8).optional(), // Auto-generate if not provided
});

/**
 * Create new customer company
 */
router.post('/customers', async (req, res, next) => {
  try {
    const data = createCustomerSchema.parse(req.body);
    
    // Determine features to enable
    let enabledFeatures = [];
    
    if (data.packageId) {
      // Use package preset
      enabledFeatures = getPackageFeatures(data.packageId);
    } else if (data.enabledFeatures?.length) {
      // Use individual selections + core
      enabledFeatures = [...getCoreFeatureIds(), ...data.enabledFeatures];
    } else {
      // Just core features
      enabledFeatures = getCoreFeatureIds();
    }
    
    // Remove duplicates
    enabledFeatures = [...new Set(enabledFeatures)];
    
    // Generate slug if not provided
    let slug = data.slug;
    if (!slug) {
      slug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    
    // Check slug uniqueness
    const existing = await prisma.company.findUnique({ where: { slug } });
    if (existing) {
      return res.status(400).json({ error: `Slug "${slug}" already exists` });
    }
    
    // Generate admin password if not provided
    const adminPassword = data.adminPassword || crypto.randomBytes(12).toString('base64').slice(0, 12);
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    // Create company with admin user in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create company
      const company = await tx.company.create({
        data: {
          name: data.name,
          slug,
          email: data.email,
          phone: data.phone,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
          logo: data.logo,
          primaryColor: data.primaryColor || '#f97316',
          secondaryColor: data.secondaryColor || '#1e293b',
          enabledFeatures,
          settings: {
            timezone: 'America/Chicago',
            dateFormat: 'MM/DD/YYYY',
            packageId: data.packageId || null,
          },
          agencyId: req.user.agencyId || req.user.companyId,
        },
      });
      
      // Create admin user for the company
      const adminUser = await tx.user.create({
        data: {
          companyId: company.id,
          email: data.adminEmail,
          password: hashedPassword,
          firstName: data.adminFirstName,
          lastName: data.adminLastName,
          role: 'admin',
          active: true,
        },
      });
      
      return { company, adminUser, generatedPassword: data.adminPassword ? null : adminPassword };
    });
    
    res.status(201).json({
      success: true,
      company: {
        id: result.company.id,
        name: result.company.name,
        slug: result.company.slug,
        enabledFeatures: result.company.enabledFeatures,
      },
      adminUser: {
        id: result.adminUser.id,
        email: result.adminUser.email,
        name: `${result.adminUser.firstName} ${result.adminUser.lastName}`,
      },
      // Only return generated password once
      generatedPassword: result.generatedPassword,
      loginUrl: `${process.env.FRONTEND_URL || 'https://app.twomiah-build.com'}/${result.company.slug}/login`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get all customers
 */
router.get('/customers', async (req, res, next) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    
    const where = {
      agencyId: req.user.agencyId || req.user.companyId,
    };
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }
    
    const [customers, total] = await Promise.all([
      prisma.company.findMany({
        where,
        include: {
          _count: {
            select: {
              users: true,
              contacts: true,
              jobs: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: +limit,
      }),
      prisma.company.count({ where }),
    ]);
    
    res.json({
      data: customers.map(c => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        email: c.email,
        logo: c.logo,
        primaryColor: c.primaryColor,
        enabledFeatures: c.enabledFeatures,
        featureCount: c.enabledFeatures?.length || 0,
        stats: c._count,
        createdAt: c.createdAt,
      })),
      pagination: {
        page: +page,
        limit: +limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get single customer details
 */
router.get('/customers/:id', async (req, res, next) => {
  try {
    const customer = await prisma.company.findFirst({
      where: {
        id: req.params.id,
        agencyId: req.user.agencyId || req.user.companyId,
      },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            active: true,
            lastLogin: true,
          },
        },
        _count: {
          select: {
            contacts: true,
            jobs: true,
            quotes: true,
            invoices: true,
            projects: true,
          },
        },
      },
    });
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    res.json({
      ...customer,
      stats: customer._count,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Update customer company info
 */
router.put('/customers/:id', async (req, res, next) => {
  try {
    const customer = await prisma.company.findFirst({
      where: {
        id: req.params.id,
        agencyId: req.user.agencyId || req.user.companyId,
      },
    });
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    const { name, email, phone, address, city, state, zip, logo, primaryColor, secondaryColor } = req.body;
    
    const updated = await prisma.company.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(zip !== undefined && { zip }),
        ...(logo !== undefined && { logo }),
        ...(primaryColor && { primaryColor }),
        ...(secondaryColor && { secondaryColor }),
      },
    });
    
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

/**
 * Update customer features (add/remove modules)
 */
router.put('/customers/:id/features', async (req, res, next) => {
  try {
    const customer = await prisma.company.findFirst({
      where: {
        id: req.params.id,
        agencyId: req.user.agencyId || req.user.companyId,
      },
    });
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    const { enabledFeatures, packageId } = req.body;
    
    let features = [];
    
    if (packageId) {
      features = getPackageFeatures(packageId);
    } else if (enabledFeatures) {
      // Core features always included
      features = [...getCoreFeatureIds(), ...enabledFeatures];
    } else {
      return res.status(400).json({ error: 'Must provide enabledFeatures or packageId' });
    }
    
    // Remove duplicates
    features = [...new Set(features)];
    
    // Validate features exist
    const allFeatures = getAllFeatureIds();
    const invalid = features.filter(f => !allFeatures.includes(f));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid features: ${invalid.join(', ')}` });
    }
    
    const updated = await prisma.company.update({
      where: { id: req.params.id },
      data: { 
        enabledFeatures: features,
        settings: {
          ...customer.settings,
          packageId: packageId || null,
        },
      },
    });
    
    res.json({
      success: true,
      enabledFeatures: updated.enabledFeatures,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Delete customer (destructive!)
 */
router.delete('/customers/:id', async (req, res, next) => {
  try {
    const customer = await prisma.company.findFirst({
      where: {
        id: req.params.id,
        agencyId: req.user.agencyId || req.user.companyId,
      },
    });
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    // Require confirmation
    if (req.body.confirmDelete !== customer.slug) {
      return res.status(400).json({ 
        error: 'Must confirm deletion by providing company slug',
        required: customer.slug,
      });
    }
    
    // Delete all company data (cascades via Prisma)
    await prisma.company.delete({ where: { id: req.params.id } });
    
    res.json({ success: true, deleted: customer.slug });
  } catch (error) {
    next(error);
  }
});

// ============================================
// ANALYTICS
// ============================================

/**
 * Get agency dashboard stats
 */
router.get('/stats', async (req, res, next) => {
  try {
    const agencyId = req.user.agencyId || req.user.companyId;
    
    const [
      totalCustomers,
      totalUsers,
      totalJobs,
      recentCustomers,
    ] = await Promise.all([
      prisma.company.count({ where: { agencyId } }),
      prisma.user.count({ where: { company: { agencyId } } }),
      prisma.job.count({ where: { company: { agencyId } } }),
      prisma.company.findMany({
        where: { agencyId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, createdAt: true },
      }),
    ]);
    
    res.json({
      totalCustomers,
      totalUsers,
      totalJobs,
      recentCustomers,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
