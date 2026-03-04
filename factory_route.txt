/**
 * Twomiah Build Factory — API Routes
 * 
 * POST /api/factory/generate  — Generate a new build from wizard config
 * GET  /api/factory/download/:buildId/:filename — Download generated zip
 * GET  /api/factory/templates  — List available templates
 * GET  /api/factory/features   — Get feature registry for wizard
 * POST /api/factory/cleanup    — Clean old builds
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import { generate, listTemplates, cleanOldBuilds, previewWebsite } from '../services/factory/generator.js';
import factoryStorage from '../services/factory/storage.js';
import factoryStripe from '../services/factory/stripe.js';
import deployService from '../services/factory/deploy.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import emailService from '../services/email.js';
import { prisma } from '../config/prisma.js';
import { createMarketingTenant } from '../services/ads/factory.js';
import logger from '../services/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const OUTPUT_DIR = process.env.TWOMIAH_BUILD_OUTPUT_DIR || path.join(PROJECT_ROOT, 'generated');

// Skip auth for public endpoints
router.use((req, res, next) => {
  if (req.path === '/features' || req.path === '/templates' || req.path === '/admin/patch-repo-urls' || req.path.startsWith('/public/')) return next();
  authenticate(req, res, next);
});
router.use((req, res, next) => {
  if (req.path === '/features' || req.path === '/templates' || req.path === '/admin/patch-repo-urls' || req.path.startsWith('/public/')) return next();
  requireRole('owner', 'admin')(req, res, next);
});


/**
 * POST /api/factory/generate
 * 
 * Body: {
 *   products: ['website', 'cms', 'crm'],
 *   company: { name, email, phone, address, city, state, zip, domain, ... },
 *   branding: { primaryColor, secondaryColor, logo },
 *   features: {
 *     website: ['blog', 'gallery', 'contact_form', ...],
 *     crm: ['contacts', 'projects', 'invoices', ...]
 *   }
 * }
 */
router.post('/generate', async (req, res) => {
  try {
    const config = req.body;

    // Validate
    if (!config.products || !Array.isArray(config.products) || config.products.length === 0) {
      return res.status(400).json({ error: 'At least one product must be selected' });
    }

    const validProducts = ['website', 'cms', 'crm'];
    const invalid = config.products.filter(p => !validProducts.includes(p));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid products: ${invalid.join(', ')}` });
    }

    if (!config.company?.name) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    logger.info(`[Factory] Generating build for "${config.company.name}" — products: ${config.products.join(', ')}`);
    const startTime = Date.now();

    const result = await generate(config);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[Factory] Build complete in ${elapsed}s — ${result.zipName}`);

    // Track customer and build in database
    let customer = null;
    let build = null;
    try {
      
      const companyId = req.user.companyId;
      const c = config.company || {};
      const slug = result.slug;

      // Create or update customer record
      if (config.customerId) {
        // Updating existing customer
        customer = await prisma.factoryCustomer.update({
          where: { id: config.customerId },
          data: {
            products: config.products,
            features: config.features?.crm || [],
            primaryColor: config.branding?.primaryColor,
            secondaryColor: config.branding?.secondaryColor,
          }
        });
      } else {
        // New customer
        customer = await prisma.factoryCustomer.create({
          data: {
            companyId,
            name: c.name,
            slug,
            email: c.email || c.adminEmail || `info@${slug}.com`,
            phone: c.phone,
            domain: c.domain,
            industry: c.industry,
            products: config.products,
            features: config.features?.crm || [],
            primaryColor: config.branding?.primaryColor,
            secondaryColor: config.branding?.secondaryColor,
            logo: config.branding?.logo ? 'uploaded' : null,
            adminEmail: c.adminEmail || c.email,
            billingType: config.billing?.type || null,
            monthlyAmount: config.billing?.monthlyAmount || null,
            oneTimeAmount: config.billing?.oneTimeAmount || null,
            planId: config.billing?.planId || null,
            wizardConfig: config,
          }
        });
      }

      // Track the build
      build = await prisma.factoryBuild.create({
        data: {
          companyId,
          customerId: customer.id,
          companyName: c.name,
          slug,
          products: config.products,
          features: config.features?.crm || [],
          config: config,
          buildId: result.buildId,
          zipPath: result.zipPath,
          zipName: result.zipName,
          storageType: result.storageType || 'local',
        }
      });
    } catch (dbErr) {
      // Don't fail the build if tracking fails
      logger.error('[Factory] Failed to track build in DB:', dbErr.message);
    }

    res.json({
      success: true,
      buildId: result.buildId,
      zipName: result.zipName,
      slug: result.slug,
      customerId: customer?.id || null,
      downloadUrl: `/api/v1/factory/download/${result.buildId}/${result.zipName}`,
      generatedIn: `${elapsed}s`,
      defaultPassword: result.defaultPassword,
      adminUrl: config?.products?.includes('website') || config?.products?.includes('cms')
        ? `https://${result.slug}-site.onrender.com/admin`
        : null,
    });

  } catch (err) {
    logger.error('[Factory] Generation failed:', err);
    res.status(500).json({ error: 'Build generation failed', details: err.message });
  }
});


/**
 * GET /api/factory/download/:buildId/:filename
 * Supports cookie auth and ?token= query param for direct browser downloads.
 * Streams from S3/R2 in production, local disk in dev.
 */
router.get('/download/:buildId/:filename', async (req, res) => {
  const { buildId, filename } = req.params;

  // Sanitize
  if (!/^[a-f0-9-]+$/.test(buildId) || !/^[a-zA-Z0-9_-]+\.zip$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid download parameters' });
  }

  // Resolve companyId from cookie auth OR ?token= for direct browser links
  let companyId = req.user?.companyId;
  if (!companyId && req.query.token) {
    try {
      const decoded = jwt.verify(req.query.token, process.env.JWT_SECRET);
      companyId = decoded.companyId;
    } catch {
      return res.status(401).json({ error: 'Invalid or expired download token' });
    }
  }
  if (!companyId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const build = await prisma.factoryBuild.findFirst({
    where: { buildId: buildId, companyId },
  });

  if (!build || !build.zipPath) {
    return res.status(404).json({ error: 'Build not found.' });
  }

  const storageType = build.storageType || 'local';
  await factoryStorage.streamZipToResponse(build.zipPath, storageType, filename, res);
});


/**
 * GET /api/factory/templates
 * Returns available template types
 */
router.get('/templates', (req, res) => {
  const templates = listTemplates();
  res.json({
    templates,
    products: [
      {
        id: 'website',
        name: 'Website',
        description: 'Server-rendered site with EJS templates, SEO optimized',
        icon: 'Globe',
        available: templates.includes('website'),
      },
      {
        id: 'cms',
        name: 'CMS',
        description: 'React admin panel for managing site content',
        icon: 'Layout',
        available: templates.includes('cms'),
        note: 'Bundled with Website when both selected',
      },
      {
        id: 'crm',
        name: 'CRM',
        description: 'Full business management with contacts, jobs, invoices, scheduling',
        icon: 'Briefcase',
        available: templates.includes('crm'),
      },
    ],
  });
});


/**
 * GET /api/factory/features
 * Returns feature categories for the wizard
 */
router.get('/features', (req, res) => {
  // Load from the CRM feature registry
  const registryPath = path.resolve(__dirname, '../config/featureRegistry.js');
  
  // Return the feature categories statically (they're defined in data/features.js on frontend)
  // This endpoint provides the backend's authoritative feature list
  res.json({
    website: [
      {
        category: 'Content',
        features: [
          { id: 'blog', name: 'Blog', description: 'Blog with categories and SEO' },
          { id: 'gallery', name: 'Gallery', description: 'Photo gallery with lightbox' },
          { id: 'testimonials', name: 'Testimonials', description: 'Customer testimonials section' },
          { id: 'services_pages', name: 'Service Pages', description: 'Individual service pages with SEO' },
        ]
      },
      {
        category: 'Lead Generation',
        features: [
          { id: 'contact_form', name: 'Contact Form', description: 'Lead capture with email notifications' },
          { id: 'service_area', name: 'Service Area Pages', description: 'Geo-targeted landing pages' },
          { id: 'financing_widget', name: 'Financing Widget', description: 'Embedded financing calculator' },
        ]
      },
      {
        category: 'SEO & Analytics',
        features: [
          { id: 'sitemap', name: 'XML Sitemap', description: 'Auto-generated sitemap' },
          { id: 'schema_markup', name: 'Schema Markup', description: 'Structured data for search' },
          { id: 'analytics', name: 'Analytics Integration', description: 'GA4, GTM, Facebook Pixel' },
        ]
      },
      {
        category: 'Tools',
        features: [
          { id: 'visualizer', name: 'Home Visualizer', description: 'AI-powered renovation visualizer' },
          { id: 'reviews_widget', name: 'Reviews Widget', description: 'Google reviews integration' },
        ]
      }
    ],
    crm: [
      {
        category: 'Core',
        features: [
          { id: 'contacts', name: 'Contacts', description: 'Client, lead, vendor management', core: true },
          { id: 'jobs', name: 'Jobs', description: 'Job tracking and management', core: true },
          { id: 'quotes', name: 'Quotes', description: 'Professional estimates and quotes', core: true },
          { id: 'invoices', name: 'Invoices', description: 'Invoice generation and tracking', core: true },
          { id: 'scheduling', name: 'Scheduling', description: 'Calendar and job scheduling', core: true },
          { id: 'team', name: 'Team', description: 'Team member management', core: true },
          { id: 'dashboard', name: 'Dashboard', description: 'Overview dashboard', core: true },
        ]
      },
      {
        category: 'Construction',
        features: [
          { id: 'projects', name: 'Projects', description: 'Multi-phase project management' },
          { id: 'rfis', name: 'RFIs', description: 'Request for information tracking' },
          { id: 'change_orders', name: 'Change Orders', description: 'Change order management' },
          { id: 'punch_lists', name: 'Punch Lists', description: 'Punch list tracking' },
          { id: 'daily_logs', name: 'Daily Logs', description: 'Field daily log reports' },
          { id: 'inspections', name: 'Inspections', description: 'Quality inspections' },
          { id: 'bid_management', name: 'Bid Management', description: 'Bid tracking and submission' },
          { id: 'takeoff_tools', name: 'Takeoff Tools', description: 'Material takeoff calculations' },
          { id: 'selections', name: 'Selections', description: 'Client material selections portal' },
        ]
      },
      {
        category: 'Service Trade',
        features: [
          { id: 'drag_drop_calendar', name: 'Drag & Drop Calendar', description: 'Visual job scheduling' },
          { id: 'recurring_jobs', name: 'Recurring Jobs', description: 'Automated recurring job creation' },
          { id: 'route_optimization', name: 'Route Optimization', description: 'Optimize daily service routes' },
          { id: 'online_booking', name: 'Online Booking', description: 'Customer self-scheduling' },
          { id: 'service_dispatch', name: 'Service Dispatch', description: 'Real-time dispatch board' },
          { id: 'service_agreements', name: 'Service Agreements', description: 'Maintenance agreement management' },
          { id: 'warranties', name: 'Warranties', description: 'Warranty tracking' },
          { id: 'pricebook', name: 'Pricebook', description: 'Standardized pricing catalog' },
        ]
      },
      {
        category: 'Field Operations',
        features: [
          { id: 'time_tracking', name: 'Time Tracking', description: 'Clock in/out with GPS' },
          { id: 'gps_tracking', name: 'GPS Tracking', description: 'Real-time crew location' },
          { id: 'photo_capture', name: 'Photo Capture', description: 'Job site photo documentation' },
          { id: 'equipment_tracking', name: 'Equipment', description: 'Equipment and tool tracking' },
          { id: 'fleet', name: 'Fleet Management', description: 'Vehicle fleet tracking' },
        ]
      },
      {
        category: 'Finance',
        features: [
          { id: 'online_payments', name: 'Online Payments', description: 'Stripe payment processing' },
          { id: 'expense_tracking', name: 'Expense Tracking', description: 'Expense logging and receipts' },
          { id: 'job_costing', name: 'Job Costing', description: 'Detailed job cost analysis' },
          { id: 'consumer_financing', name: 'Consumer Financing', description: 'Wisetack financing integration' },
          { id: 'quickbooks', name: 'QuickBooks', description: 'QuickBooks sync' },
        ]
      },
      {
        category: 'Communication',
        features: [
          { id: 'two_way_texting', name: 'Two-Way Texting', description: 'SMS communication with clients' },
          { id: 'call_tracking', name: 'Call Tracking', description: 'Inbound call tracking and recording' },
          { id: 'client_portal', name: 'Client Portal', description: 'Customer-facing project portal' },
        ]
      },
      {
        category: 'Marketing',
        features: [
          { id: 'paid_ads', name: 'Paid Ads Hub (Google + Meta)', description: 'Google & Meta campaign management, lead tracking, monthly ROI reports' },
          { id: 'google_reviews', name: 'Google Reviews', description: 'Review request automation' },
          { id: 'email_marketing', name: 'Email Marketing', description: 'Drip campaigns and newsletters' },
          { id: 'referral_program', name: 'Referral Program', description: 'Customer referral tracking' },
        ]
      },
      {
        category: 'Advanced',
        features: [
          { id: 'inventory', name: 'Inventory', description: 'Warehouse and material inventory' },
          { id: 'documents', name: 'Documents', description: 'Document management and storage' },
          { id: 'reports', name: 'Reports', description: 'Custom reporting dashboard' },
          { id: 'custom_dashboards', name: 'Custom Dashboards', description: 'Drag-and-drop widget dashboards' },
          { id: 'ai_receptionist', name: 'AI Receptionist', description: 'AI-powered call handling' },
          { id: 'map_view', name: 'Map View', description: 'Map-based job visualization' },
        ]
      }
    ]
  });
});



/**
 * POST /api/factory/preview
 * Render a preview of the website with wizard config (no files written)
 */
router.post('/preview', (req, res) => {
  try {
    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config required' });
    const html = previewWebsite(config);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('[Factory] Preview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});



/**
 * POST /api/factory/generate-content
 * Use Claude API to generate tailored website copy from company info
 */
router.post('/generate-content', async (req, res) => {
  try {
    const { companyName, city, state, industry, services, serviceRegion, ownerName, description } = req.body;

    if (!companyName) {
      return res.status(400).json({ error: 'companyName is required' });
    }

    const isHomeCare = industry === 'home_care';
    const location = [city, state].filter(Boolean).join(', ') || 'your area';
    const region = serviceRegion || city || 'the area';

    const prompt = `You are writing website copy for a ${isHomeCare ? 'home care' : 'home improvement contractor'} company.

Company: ${companyName}
Location: ${location}
Service region: ${region}
${ownerName ? `Owner: ${ownerName}` : ''}
${description ? `About: ${description}` : ''}
Services offered: ${(services || []).join(', ')}

Write the following in JSON format with these exact keys:
{
  "heroTagline": "short 3-6 word badge text shown in the hero section (e.g. 'Compassionate In-Home Care' or 'Licensed & Insured Since 2010')",
  "aboutText": "2-3 sentence paragraph about this company, warm and trustworthy tone, mention the city/region",
  "ctaText": "one sentence call-to-action for the contact banner (ends with a question or invitation, no period)",
  "serviceDescriptions": {
    "service-id": {
      "short": "one sentence, 15-20 words max",
      "long": "2-3 sentences describing this service in detail"
    }
  }
}

Only include service descriptions for these service IDs: ${(services || []).join(', ')}
Return ONLY valid JSON. No markdown, no explanation.`;

    // Call Anthropic API
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();
    // Strip markdown fences if present
    const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const generated = JSON.parse(cleaned);

    res.json(generated);
  } catch (err) {
    console.error('[Factory] generate-content error:', err.message);
    res.status(500).json({ error: 'Content generation failed', details: err.message });
  }
});


/**
 * POST /api/factory/cleanup
 * Clean old generated builds
 */
router.post('/cleanup', (req, res) => {
  const maxAge = req.body?.maxAge || 24 * 60 * 60 * 1000; // 24 hours default
  const cleaned = cleanOldBuilds(maxAge);
  res.json({ cleaned, message: `Removed ${cleaned} old builds` });
});


// ═══════════════════════════════════════════════════════════════════
// CUSTOMER MANAGEMENT & BILLING
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/factory/stats
 * Dashboard stats for operator
 */
router.post('/admin/patch-repo-urls', async (req, res) => {
  try {
    const customers = await prisma.factoryCustomer.findMany({ where: { repoUrl: null } });
    const updates = await Promise.all(customers.map(c =>
      prisma.factoryCustomer.update({
        where: { id: c.id },
        data: { repoUrl: `https://github.com/Jeremiahandson1/${c.slug}` }
      })
    ));
    res.json({ updated: updates.length, customers: updates.map(u => ({ slug: u.slug, repoUrl: u.repoUrl })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/debug/templates', async (req, res) => {
  const fs = (await import('fs')).default;
  const path = (await import('path')).default;
  const __file = new URL(import.meta.url).pathname;
  const PROJECT_ROOT = path.resolve(__file, '..', '..', '..', '..');
  const TEMPLATES_ROOT = process.env.TWOMIAH_BUILD_TEMPLATES_DIR || path.join(PROJECT_ROOT, 'templates');
  const result = { TEMPLATES_ROOT, templates: {} };
  try {
    const dirs = fs.readdirSync(TEMPLATES_ROOT);
    for (const dir of dirs) {
      const pagesPath = path.join(TEMPLATES_ROOT, dir, 'admin', 'src', 'pages');
      if (fs.existsSync(pagesPath)) {
        result.templates[dir] = fs.readdirSync(pagesPath);
      }
    }
  } catch (e) { result.error = e.message; }
  res.json(result);
});

router.get('/stats', async (req, res) => {
  try {
    
    const companyId = req.user.companyId;

    const [totalCustomers, totalBuilds, activeCustomers, recentBuilds] = await Promise.all([
      prisma.factoryCustomer.count({ where: { companyId } }),
      prisma.factoryBuild.count({ where: { companyId } }),
      prisma.factoryCustomer.count({ where: { companyId, status: 'active' } }),
      prisma.factoryBuild.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { customer: { select: { name: true } } }
      }),
    ]);

    // Calculate monthly revenue from active subscriptions
    const activeSubscriptions = await prisma.factoryCustomer.findMany({
      where: { 
        companyId, 
        billingStatus: 'active',
        billingType: 'subscription',
        monthlyAmount: { not: null }
      },
      select: { monthlyAmount: true }
    });
    const monthlyRevenue = activeSubscriptions.reduce(
      (sum, c) => sum + (parseFloat(c.monthlyAmount) || 0), 0
    );

    // One-time revenue this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const oneTimeRevenue = await prisma.factoryCustomer.aggregate({
      where: {
        companyId,
        billingType: 'one_time',
        paidAt: { gte: startOfMonth }
      },
      _sum: { oneTimeAmount: true }
    });

    res.json({
      totalCustomers,
      totalBuilds,
      activeCustomers,
      monthlyRevenue: monthlyRevenue + (parseFloat(oneTimeRevenue._sum.oneTimeAmount) || 0),
      recentBuilds: recentBuilds.map(b => ({
        companyName: b.customer?.name || b.companyName,
        products: b.products,
        status: b.status,
        createdAt: b.createdAt,
        buildId: b.buildId,
      })),
    });
  } catch (err) {
    logger.error('Stats error:', err);
    res.json({
      totalCustomers: 0,
      totalBuilds: 0,
      activeCustomers: 0,
      monthlyRevenue: 0,
      recentBuilds: [],
    });
  }
});


/**
 * GET /api/factory/customers
 * List all factory customers
 */
/**
 * DELETE /api/factory/builds/:id
 */
router.delete('/builds/:id', async (req, res) => {
  try {
    
    const build = await prisma.factoryBuild.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });
    if (!build) return res.status(404).json({ error: 'Build not found' });

    // Delete zip from disk if it exists
    if (build.zipPath && fs.existsSync(build.zipPath)) {
      fs.unlinkSync(build.zipPath);
    }

    await prisma.factoryBuild.delete({ where: { id: build.id } });
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete build error:', err);
    res.status(500).json({ error: 'Failed to delete build' });
  }
});

router.get('/builds', async (req, res, next) => {
  try {
    
    const companyId = req.user.companyId;
    const builds = await prisma.factoryBuild.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        companyName: true,
        slug: true,
        products: true,
        buildId: true,
        zipName: true,
        zipPath: true,
        createdAt: true,
        customer: { select: { name: true, status: true } }
      }
    });
    res.json({ builds });
  } catch (err) { next(err); }
});

router.get('/customers', async (req, res) => {
  try {
    
    const companyId = req.user.companyId;
    const { status, billing, search } = req.query;

    const where = { companyId };
    if (status) where.status = status;
    if (billing) where.billingStatus = billing;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { domain: { contains: search, mode: 'insensitive' } },
      ];
    }

    const customers = await prisma.factoryCustomer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        builds: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true, buildId: true, status: true }
        }
      }
    });

    // Enrich with dashboard-friendly fields
    const enriched = customers.map(c => ({
      ...c,
      companyName: c.name,
      deployStatus: c.status === 'active' || c.status === 'deployed' ? 'deployed'
        : c.status === 'generated' ? 'pending'
        : c.status === 'failed' ? 'failed' : c.status,
      leadsCount: c.leadsCount || 0,
      siteUrl: c.siteUrl || c.deployedUrl || (c.slug ? `https://${c.slug}-site.onrender.com` : null),
    }));

    res.json(enriched);
  } catch (err) {
    logger.error('Customers error:', err);
    res.json([]);
  }
});


/**
 * GET /api/factory/customers/:id
 * Get single customer with full detail
 */
router.get('/customers/:id', async (req, res) => {
  try {
    
    const customer = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
      include: {
        builds: { orderBy: { createdAt: 'desc' } }
      }
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(customer);
  } catch (err) {
    logger.error('Customer detail error:', err);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});


/**
 * PATCH /api/factory/customers/:id
 * Update customer (status, billing, notes, urls)
 */
router.patch('/customers/:id', async (req, res) => {
  try {
    // Verify ownership before update
    const owned = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId }
    });
    if (!owned) return res.status(404).json({ error: 'Customer not found' });

    const { 
      status, billingType, billingStatus, planId, 
      monthlyAmount, oneTimeAmount, paidAt, nextBillingDate,
      deployedUrl, apiUrl, siteUrl, notes,
      stripeCustomerId, stripeSubscriptionId
    } = req.body;

    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (billingType !== undefined) updateData.billingType = billingType;
    if (billingStatus !== undefined) updateData.billingStatus = billingStatus;
    if (planId !== undefined) updateData.planId = planId;
    if (monthlyAmount !== undefined) updateData.monthlyAmount = monthlyAmount;
    if (oneTimeAmount !== undefined) updateData.oneTimeAmount = oneTimeAmount;
    if (paidAt !== undefined) updateData.paidAt = paidAt ? new Date(paidAt) : null;
    if (nextBillingDate !== undefined) updateData.nextBillingDate = nextBillingDate ? new Date(nextBillingDate) : null;
    if (deployedUrl !== undefined) updateData.deployedUrl = deployedUrl;
    if (apiUrl !== undefined) updateData.apiUrl = apiUrl;
    if (siteUrl !== undefined) updateData.siteUrl = siteUrl;
    if (notes !== undefined) updateData.notes = notes;
    if (stripeCustomerId !== undefined) updateData.stripeCustomerId = stripeCustomerId;
    if (stripeSubscriptionId !== undefined) updateData.stripeSubscriptionId = stripeSubscriptionId;

    const customer = await prisma.factoryCustomer.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json(customer);
  } catch (err) {
    logger.error('Customer update error:', err);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});


/**
 * DELETE /api/factory/customers/:id
 * Delete customer record
 */
router.delete('/customers/:id', async (req, res) => {
  try {
    const existing = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId }
    });
    if (!existing) return res.status(404).json({ error: 'Customer not found' });
    await prisma.factoryCustomer.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true });
  } catch (err) {
    logger.error('Customer delete error:', err);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});


/**
 * GET /api/factory/billing/summary
 * Revenue summary for operator dashboard
 */
router.get('/billing/summary', async (req, res) => {
  try {
    
    const companyId = req.user.companyId;

    const [subscriptions, oneTime, pastDue] = await Promise.all([
      prisma.factoryCustomer.findMany({
        where: { companyId, billingType: 'subscription', billingStatus: 'active' },
        select: { name: true, monthlyAmount: true, planId: true, nextBillingDate: true }
      }),
      prisma.factoryCustomer.findMany({
        where: { companyId, billingType: 'one_time' },
        select: { name: true, oneTimeAmount: true, paidAt: true }
      }),
      prisma.factoryCustomer.findMany({
        where: { companyId, billingStatus: 'past_due' },
        select: { name: true, monthlyAmount: true, email: true }
      }),
    ]);

    const mrr = subscriptions.reduce(
      (sum, c) => sum + (parseFloat(c.monthlyAmount) || 0), 0
    );
    const arr = mrr * 12;
    const totalOneTime = oneTime.reduce(
      (sum, c) => sum + (parseFloat(c.oneTimeAmount) || 0), 0
    );

    res.json({
      mrr,
      arr,
      totalOneTimeRevenue: totalOneTime,
      activeSubscriptions: subscriptions.length,
      pastDueCount: pastDue.length,
      pastDueCustomers: pastDue,
      subscriptions,
      oneTimeCustomers: oneTime,
    });
  } catch (err) {
    logger.error('Billing summary error:', err);
    res.json({ mrr: 0, arr: 0, totalOneTimeRevenue: 0, activeSubscriptions: 0, pastDueCount: 0 });
  }
});


// ═══════════════════════════════════════════════════════════════════
// AUTO-DEPLOY TO RENDER
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/factory/deploy/config
 * Check if auto-deploy is configured (boolean only — no env var names exposed)
 */
router.get('/deploy/config', (req, res) => {
  res.json({
    configured: deployService.isConfigured(),
  });
});


/**
 * POST /api/factory/customers/:id/deploy
 * Deploy a customer to Render (full pipeline)
 * Body: { region, plan }
 */
router.post('/customers/:id/deploy', async (req, res) => {
  try {
    if (!deployService.isConfigured()) {
      return res.status(400).json({
        error: 'Deploy not configured',
        missing: deployService.getMissingConfig(),
      });
    }

    
    const customer = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
      include: { builds: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    // Find latest build zip
    const latestBuild = customer.builds[0];
    if (!latestBuild?.zipPath) {
      return res.status(400).json({ error: 'No build found. Generate a package first.' });
    }

    // Check zip exists — if not, regenerate it
    let zipPath = latestBuild.zipPath;
    const { existsSync } = await import('fs');
    if (true) { // always regenerate for deploy to ensure latest template
      logger.info(`[Deploy] Zip not on disk, regenerating for ${customer.slug}...`);
      try {
        const { generate: generatePackage } = await import('../services/factory/generator.js');
        const regen = await generatePackage(customer.wizardConfig || {
          products: customer.products,
          company: {
            name: customer.name,
            slug: customer.slug,
            email: customer.email,
            phone: customer.phone,
            address: customer.address,
            city: customer.city,
            state: customer.state,
            zip: customer.zip,
            domain: customer.domain,
          },
          branding: {
            primaryColor: customer.primaryColor || '#f97316',
            secondaryColor: customer.secondaryColor || '#1e293b',
          },
          features: customer.enabledFeatures || [],
        });
        zipPath = regen.zipPath;
        // Update the build record with new zip path
        await prisma.factoryBuild.update({
          where: { id: latestBuild.id },
          data: { zipPath: regen.zipPath },
        });
      } catch (regenErr) {
        return res.status(500).json({ error: `Could not regenerate package: ${regenErr.message}` });
      }
    }

    // Update status to deploying
    await prisma.factoryCustomer.update({
      where: { id: customer.id },
      data: { status: 'deploying' },
    });

    // Deploy async — don't block the response
    const { region, plan } = req.body;

    // Send immediate response
    res.json({ message: 'Deployment started', status: 'deploying' });

    // Run deployment in background
    try {
    // Download zip from R2 to local /tmp for deploy
    const storageType = latestBuild.storageType || 's3';
    zipPath = await factoryStorage.downloadZip(zipPath, storageType);
      const result = await deployService.deployCustomer(customer, zipPath, {
        region: region || 'ohio',
        plan: plan || 'free',
      });

      // Store service IDs and URLs
      const updateData = {
        status: result.success ? 'deployed' : 'generated',
      };

      if (result.apiUrl) updateData.apiUrl = result.apiUrl;
      if (result.deployedUrl) updateData.deployedUrl = result.deployedUrl;
      if (result.siteUrl) updateData.siteUrl = result.siteUrl;
      if (result.repoUrl) updateData.notes = `${customer.notes || ''}\nGitHub: ${result.repoUrl}`.trim();

        // Store Render service IDs for status tracking
        if (result.services) {
          const serviceIds = {};
          if (result.services.backend?.id) serviceIds.backend = result.services.backend.id;
          if (result.services.frontend?.id) serviceIds.frontend = result.services.frontend.id;
          if (result.services.site?.id) serviceIds.site = result.services.site.id;
          if (result.services.database?.id) serviceIds.database = result.services.database.id;
          updateData.renderServiceIds = JSON.stringify(serviceIds);
          if (result.repoUrl) updateData.repoUrl = result.repoUrl;
        }

      await prisma.factoryCustomer.update({
        where: { id: customer.id },
        data: updateData,
      });

      // ── Spin up marketing tenant if paid_ads was selected ─────────────────
      const customerFeatures = Array.isArray(customer.features) ? customer.features : [];
      if (result.success && customerFeatures.includes('paid_ads')) {
        try {
          await createMarketingTenant(customer.id, {
            client:      customer.slug,
            vertical:    customer.industry || 'general_contractor',
            city:        customer.city,
            state:       customer.state,
            websiteUrl:  result.siteUrl || customer.domain,
            notifyPhone: customer.phone,
            notifyEmail: customer.email,
            tier:        customer.planId || 'starter',
          });
          logger.info(`[Factory] Marketing tenant created for ${customer.slug}`);
        } catch (mktErr) {
          // Non-fatal — marketing setup can be triggered manually from the hub
          logger.error(`[Factory] Marketing tenant setup failed for ${customer.slug}:`, mktErr.message);
        }
      }


      // ── Send onboarding email to customer ─────────────────────────────────
      if (result.success && customer.email) {
        try {
          const products = Array.isArray(customer.products) ? customer.products : [];
          const productName = products.includes('crm') && products.includes('website')
            ? 'CRM + Website'
            : products.includes('crm') ? 'CRM' : 'Website';

          await emailService.sendFactoryCustomerOnboarding(customer.email, {
            contactName: customer.companyName,
            productName,
            loginEmail: customer.email,
            tempPassword: customer.adminPassword || 'Check with your account manager',
            crmUrl: result.deployedUrl || null,
            cmsUrl: result.siteUrl || null,
            siteUrl: result.siteUrl || null,
          });
          logger.info(`[Factory] Onboarding email sent to ${customer.email}`);
        } catch (emailErr) {
          logger.error(`[Factory] Onboarding email failed for ${customer.slug}:`, emailErr.message);
        }
      }

      console.error('[Deploy Result]', JSON.stringify(result, null, 2));
    } catch (deployErr) {
      logger.error(`Deploy ${customer.slug} FAILED:`, deployErr);
      await prisma.factoryCustomer.update({
        where: { id: customer.id },
        data: { status: 'generated' },
      });
    }
  } catch (err) {
    logger.error('Deploy endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * GET /api/factory/customers/:id/deploy/status
 * Check deploy status for a customer's Render services
 */
router.get('/customers/:id/deploy/status', async (req, res) => {
  try {
    if (!deployService.isConfigured()) {
      return res.json({ configured: false });
    }

    
    const customer = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });

    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    // Parse service IDs from renderServiceIds field
    let renderServiceIds = null;
    try {
      if (customer.renderServiceIds) {
        renderServiceIds = JSON.parse(customer.renderServiceIds);
      }
    } catch (e) { /* malformed JSON */ }

    if (!renderServiceIds) {
      return res.json({ status: 'not_deployed', services: {} });
    }

    const result = await deployService.checkDeployStatus({ renderServiceIds });
    res.json(result);
  } catch (err) {
    logger.error('Deploy status error:', err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /api/factory/customers/:id/redeploy
 * Trigger a redeploy of all services
 */


// ─── Public Self-Serve Signup ─────────────────────────────────────────────────
// No auth required — these are the public-facing onboarding endpoints

/**
 * POST /api/v1/factory/public/signup
 * Creates a pending customer record and returns a Stripe Checkout URL.
 * industry: 'contractor' | 'home_care'
 */
router.post('/public/signup', async (req, res) => {
  try {
    const { company, branding, industry, plan = 'professional' } = req.body;

    if (!company?.name || !company?.email) {
      return res.status(400).json({ error: 'Company name and email are required' });
    }

    // Map industry to products
    const productsByIndustry = {
      contractor: ['website', 'cms', 'crm'],
      home_care: ['website', 'cms', 'crm'],
    };
    const products = productsByIndustry[industry] || ['website', 'cms', 'crm'];

    // Map plan to price
    const planPrices = {
      starter: 9700,       // $97
      professional: 19700, // $197
      growth: 29700,       // $297
    };
    const priceAmount = planPrices[plan] || 19700;
    const planName = plan.charAt(0).toUpperCase() + plan.slice(1);

    // Generate slug
    const slug = company.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 40) + '-' + Date.now().toString(36);

    // Generate temp password
    const tempPassword = Math.random().toString(36).slice(2, 8).toUpperCase() +
      Math.random().toString(36).slice(2, 6) + '!';

    // Find or use default operator company (Twomiah's own companyId)
    const operatorCompany = await prisma.company.findFirst({
      where: { name: { contains: 'Twomiah', mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
    });
    if (!operatorCompany) {
      return res.status(500).json({ error: 'Operator company not configured' });
    }

    // Create pending customer record
    const customer = await prisma.factoryCustomer.create({
      data: {
        companyId: operatorCompany.id,
        companyName: company.name,
        slug,
        email: company.email,
        phone: company.phone || null,
        industry,
        city: company.city || null,
        state: company.state || null,
        products,
        status: 'pending_payment',
        adminPassword: tempPassword,
        wizardConfig: {
          products,
          company: {
            name: company.name,
            email: company.email,
            phone: company.phone || '',
            city: company.city || '',
            state: company.state || '',
            ownerName: company.ownerName || '',
            industry,
          },
          branding: branding || {},
        },
        planId: plan,
        billingType: 'subscription',
        billingStatus: 'pending',
        monthlyAmount: priceAmount / 100,
      },
    });

    // Create Stripe Checkout session
    if (!stripe) {
      // Dev mode — skip payment, auto-deploy
      return res.json({ 
        success: true, 
        dev: true, 
        customerId: customer.id,
        message: 'Dev mode: Stripe not configured. Customer created.' 
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: company.email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Twomiah ${industry === 'home_care' ? 'Care' : 'Build'} — ${planName}`,
            description: `${products.join(', ')} • ${company.name}`,
          },
          unit_amount: priceAmount,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      metadata: {
        customerId: customer.id,
        industry,
        plan,
      },
      success_url: `${process.env.FRONTEND_URL || 'https://buildpro-app-dcsx.onrender.com'}/signup/success?session_id={CHECKOUT_SESSION_ID}&customer=${customer.id}`,
      cancel_url: `${process.env.TWOMIAH_SITE_URL || 'https://twomiah.com'}/${industry === 'home_care' ? 'care' : 'build'}.html?canceled=1`,
    });

    res.json({ checkoutUrl: session.url, customerId: customer.id, sessionId: session.id });
  } catch (err) {
    logger.error('[Public Signup] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/factory/public/signup/status/:customerId
 * Check status of a pending signup (polled after payment)
 */
router.get('/public/signup/status/:customerId', async (req, res) => {
  try {
    const customer = await prisma.factoryCustomer.findUnique({
      where: { id: req.params.customerId },
      select: { 
        id: true, status: true, companyName: true, 
        siteUrl: true, deployedUrl: true, apiUrl: true,
        email: true, adminPassword: true,
      },
    });
    if (!customer) return res.status(404).json({ error: 'Not found' });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Domain Management ────────────────────────────────────────────────────────

router.post('/customers/:id/domain', async (req, res) => {
  try {
    const { domain, type } = req.body; // type: 'custom' | 'subdomain'
    if (!domain) return res.status(400).json({ error: 'Domain required' });

    const customer = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    // Add domain to Render site service if we have the service ID
    let renderServiceIds = null;
    try { if (customer.renderServiceIds) renderServiceIds = JSON.parse(customer.renderServiceIds); } catch(e) {}
    
    const siteServiceId = renderServiceIds?.site;
    if (siteServiceId && process.env.RENDER_API_KEY) {
      // Add custom domain to Render service
      const renderRes = await fetch(`https://api.render.com/v1/services/${siteServiceId}/custom-domains`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RENDER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      });
      if (!renderRes.ok) {
        const err = await renderRes.json();
        logger.warn('[Domain] Render API error:', err);
        // Don't fail — save domain anyway, operator can add manually
      }
    }

    // Save domain to customer record
    const updated = await prisma.factoryCustomer.update({
      where: { id: customer.id },
      data: { domain, siteUrl: `https://${domain}` },
    });

    res.json({ success: true, domain, customer: updated });
  } catch (err) {
    logger.error('[Domain] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/customers/:id/domain', async (req, res) => {
  try {
    const customer = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    await prisma.factoryCustomer.update({
      where: { id: customer.id },
      data: { domain: null },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/customers/:id/regenerate', async (req, res) => {
  try {
    const customer = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (!customer.wizardConfig) return res.status(400).json({ error: 'No saved config found for this customer' });

    res.json({ message: 'Regenerating package and deploying...', status: 'deploying' });

    try {
      await prisma.factoryCustomer.update({ where: { id: customer.id }, data: { status: 'deploying', renderServiceIds: null } });
      const config = typeof customer.wizardConfig === 'string' ? JSON.parse(customer.wizardConfig) : customer.wizardConfig;
      const { zipPath, zipName, buildId, slug, storageType, defaultPassword } = await generate(config);
      await prisma.factoryBuild.create({
        data: {
          customerId: customer.id,
          companyId: customer.companyId,
          companyName: customer.companyName || customer.slug,
          slug: customer.slug,
          zipPath,
          zipName,
          buildId,
          status: 'generated',
          storageType: storageType || 's3',
        },
      });
      const result = await deployService.deployCustomer(customer, zipPath, {});
      const updateData = { status: result.success ? 'deployed' : 'generated' };
      if (result.apiUrl) updateData.apiUrl = result.apiUrl;
      if (result.deployedUrl) updateData.deployedUrl = result.deployedUrl;
      if (result.siteUrl) updateData.siteUrl = result.siteUrl;
      if (result.repoUrl) updateData.repoUrl = result.repoUrl;
      if (result.services) updateData.renderServiceIds = JSON.stringify({
        backend: result.services.backend?.id,
        frontend: result.services.frontend?.id,
        site: result.services.site?.id,
        database: result.services.database?.id,
      });
      await prisma.factoryCustomer.update({ where: { id: customer.id }, data: updateData });
    } catch (err) {
      logger.error('[Regenerate] Failed:', err);
      await prisma.factoryCustomer.update({ where: { id: customer.id }, data: { status: 'failed' } }).catch(() => {});
    }
  } catch (err) {
    logger.error('[Regenerate] Error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

router.post('/customers/:id/redeploy', async (req, res) => {
  try {
    if (!deployService.isConfigured()) {
      return res.status(400).json({ error: 'Deploy not configured' });
    }

    
    const customer = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });

    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    let renderServiceIds = null;
    try {
      if (customer.renderServiceIds) renderServiceIds = JSON.parse(customer.renderServiceIds);
    } catch (e) { /* */ }

    if (!renderServiceIds) {
      // No service IDs — fall back to full deploy flow
      logger.info(`[Redeploy] No service IDs for ${customer.slug}, running full deploy...`);
      const latestBuild = await prisma.factoryBuild.findFirst({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
      });
      if (!latestBuild?.zipPath) {
        return res.status(400).json({ error: 'No build found. Generate a package first.' });
      }
      res.json({ message: 'Full deployment started', status: 'deploying' });
      try {
        await prisma.factoryCustomer.update({ where: { id: customer.id }, data: { status: 'deploying' } });
        let zipPath = await factoryStorage.downloadZip(latestBuild.zipPath, latestBuild.storageType || 's3');
        const result = await deployService.deployCustomer(customer, zipPath, {});
        const updateData = { status: result.success ? 'deployed' : 'generated' };
        if (result.apiUrl) updateData.apiUrl = result.apiUrl;
        if (result.deployedUrl) updateData.deployedUrl = result.deployedUrl;
        if (result.siteUrl) updateData.siteUrl = result.siteUrl;
        if (result.repoUrl) updateData.repoUrl = result.repoUrl;
        if (result.services) {
          const serviceIds = {};
          if (result.services.backend?.id) serviceIds.backend = result.services.backend.id;
          if (result.services.frontend?.id) serviceIds.frontend = result.services.frontend.id;
          if (result.services.site?.id) serviceIds.site = result.services.site.id;
          updateData.renderServiceIds = JSON.stringify(serviceIds);
        }
        await prisma.factoryCustomer.update({ where: { id: customer.id }, data: updateData });
        logger.info(`[Redeploy] Full deploy complete for ${customer.slug}: ${result.status}`);
      } catch (err) {
        logger.error(`[Redeploy] Full deploy failed for ${customer.slug}:`, err.message);
        await prisma.factoryCustomer.update({ where: { id: customer.id }, data: { status: 'generated' } });
      }
      return;
    }
    const result = await deployService.redeployCustomer({ renderServiceIds });
    res.json(result);
  } catch (err) {
    logger.error('Redeploy error:', err);
    res.status(500).json({ error: err.message });
  }


});
// -----------------------------------------------------------------------------
// PUSH UPDATE - regenerate and push latest templates to customer GitHub repo
// -----------------------------------------------------------------------------
router.post('/customers/:id/push-update', async (req, res) => {
  try {
    const customer = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
      include: { builds: { orderBy: { createdAt: 'desc' }, take: 1 } }
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (!customer.repoUrl) return res.status(400).json({ error: 'No GitHub repo found for this customer' });

    res.json({ success: true, message: 'Update started' });

    setImmediate(async () => {
      try {
        const { generate: generatePackage } = await import('../services/factory/generator.js');
        const regen = await generatePackage(customer.wizardConfig || {
          products: customer.products,
          company: {
            name: customer.name,
            slug: customer.slug,
            email: customer.email,
            phone: customer.phone,
            domain: customer.domain,
            industry: customer.industry,
            city: customer.city,
            state: customer.state,
            zip: customer.zip,
          },
          branding: {
            primaryColor: customer.primaryColor || '#f97316',
            secondaryColor: customer.secondaryColor || '#1e293b',
          },
          features: { crm: customer.features || [] },
        });
        const zipPath = await factoryStorage.downloadZip(regen.zipPath, regen.storageType || 's3');
        const extractDir = `/tmp/update-${customer.slug}-${Date.now()}`;
        const AdmZip = (await import('adm-zip')).default;
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractDir, true);
        const repoFullName = customer.repoUrl.replace('https://github.com/', '');
        const { deployCustomer } = await import('../services/factory/deploy.js');
        const { pushToGitHub } = await import('../services/factory/deploy.js'); await pushToGitHub(repoFullName, extractDir);
        logger.info(`[PushUpdate] Successfully pushed update to ${repoFullName}`);
      } catch (err) {
        logger.error('[PushUpdate] Failed:', err);
      }
    });
  } catch (err) {
    logger.error('Push update error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════
// STRIPE CHECKOUT & BILLING
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/factory/stripe/config
 * Returns publishable key and whether Stripe is configured
 */
router.get('/stripe/config', (req, res) => {
  res.json({
    configured: factoryStripe.isConfigured(),
    publishableKey: factoryStripe.getPublishableKey(),
  });
});


/**
 * POST /api/factory/customers/:id/checkout/subscription
 * Create a Stripe Checkout session for subscription billing
 * Body: { planId, monthlyAmount, billingCycle, trialDays }
 */
router.post('/customers/:id/checkout/subscription', async (req, res) => {
  try {
    
    const customer = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const { planId, monthlyAmount, billingCycle, trialDays } = req.body;

    const result = await factoryStripe.createSubscriptionCheckout(customer, {
      planId: planId || customer.planId || 'custom',
      monthlyAmount: monthlyAmount || parseFloat(customer.monthlyAmount) || 149,
      billingCycle: billingCycle || 'monthly',
      trialDays: trialDays || 0,
    });

    // Save Stripe customer ID if new
    if (result.stripeCustomerId && result.stripeCustomerId !== customer.stripeCustomerId) {
      await prisma.factoryCustomer.update({
        where: { id: customer.id },
        data: { stripeCustomerId: result.stripeCustomerId },
      });
    }

    res.json(result);
  } catch (err) {
    logger.error('Subscription checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /api/factory/customers/:id/checkout/license
 * Create a Stripe Checkout session for one-time license purchase
 * Body: { planId, amount, description }
 */
router.post('/customers/:id/checkout/license', async (req, res) => {
  try {
    
    const customer = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const { planId, amount, description } = req.body;

    const result = await factoryStripe.createLicenseCheckout(customer, {
      planId: planId || customer.planId || 'custom',
      amount: amount || parseFloat(customer.oneTimeAmount) || 2497,
      description,
    });

    if (result.stripeCustomerId && result.stripeCustomerId !== customer.stripeCustomerId) {
      await prisma.factoryCustomer.update({
        where: { id: customer.id },
        data: { stripeCustomerId: result.stripeCustomerId },
      });
    }

    res.json(result);
  } catch (err) {
    logger.error('License checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /api/factory/customers/:id/portal
 * Create a Stripe Customer Portal session (self-service billing)
 */
router.post('/customers/:id/portal', async (req, res) => {
  try {
    
    const customer = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (!customer.stripeCustomerId) {
      return res.status(400).json({ error: 'Customer has no Stripe billing set up' });
    }

    const result = await factoryStripe.createPortalSession(customer);
    res.json(result);
  } catch (err) {
    logger.error('Portal session error:', err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /api/factory/customers/:id/cancel
 * Cancel a customer's subscription
 * Body: { immediate: boolean }
 */
router.post('/customers/:id/cancel', async (req, res) => {
  try {
    
    const customer = await prisma.factoryCustomer.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const result = await factoryStripe.cancelSubscription(customer, {
      atPeriodEnd: !req.body.immediate,
    });

    // Update local record
    await prisma.factoryCustomer.update({
      where: { id: customer.id },
      data: {
        billingStatus: result.immediate ? 'canceled' : 'canceling',
        status: result.immediate ? 'suspended' : customer.status,
      },
    });

    res.json(result);
  } catch (err) {
    logger.error('Cancel error:', err);
    res.status(500).json({ error: err.message });
  }
});



// ─── Stripe Webhook ────────────────────────────────────────────────────────────
// Must use raw body — registered before JSON middleware in index.js

router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_FACTORY_WEBHOOK_SECRET;

  let event;
  try {
    if (webhookSecret) {
      event = factoryStripe.verifyWebhook(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    logger.error('[Factory Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    // Handle public signup payment completion
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const meta = session.metadata || {};
      const customerId = meta.customerId || meta.factory_customer_id;

      if (customerId) {
        // Find the pending customer
        const customer = await prisma.factoryCustomer.findUnique({
          where: { id: customerId },
        });

        if (customer && customer.status === 'pending_payment') {
          // Mark as paid
          await prisma.factoryCustomer.update({
            where: { id: customerId },
            data: {
              billingStatus: 'active',
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription,
            },
          });

          // Trigger generate + deploy in background
          setImmediate(async () => {
            try {
              logger.info(`[Public Signup] Auto-deploying for ${customer.companyName}`);
              
              const wizardConfig = customer.wizardConfig || {};
              const { zipPath, zipName, buildId } = await generate(wizardConfig, {
                outputDir: `/tmp/factory-builds/${customer.slug}`,
              });

              // Store build record
              const storageType = process.env.R2_BUCKET_NAME ? 'r2' : 's3';
              await factoryStorage.uploadZip(zipPath, zipName, storageType);

              const build = await prisma.factoryBuild.create({
                data: {
                  customerId: customer.id,
                  companyId: customer.companyId,
                  companyName: customer.companyName,
                  slug: customer.slug,
                  zipPath, zipName, buildId,
                  status: 'generated',
                  storageType,
                },
              });

              await prisma.factoryCustomer.update({
                where: { id: customer.id },
                data: { status: 'generated', latestBuildId: build.id },
              });

              // Deploy
              const result = await deployService.deployCustomer(customer, zipPath, {
                region: 'ohio',
                plan: 'free',
              });

              const updateData = { status: result.success ? 'deployed' : 'generated' };
              if (result.apiUrl) updateData.apiUrl = result.apiUrl;
              if (result.deployedUrl) updateData.deployedUrl = result.deployedUrl;
              if (result.siteUrl) updateData.siteUrl = result.siteUrl;
              if (result.services) {
                const serviceIds = {};
                if (result.services.backend?.id) serviceIds.backend = result.services.backend.id;
                if (result.services.site?.id) serviceIds.site = result.services.site.id;
                updateData.renderServiceIds = JSON.stringify(serviceIds);
              }

              await prisma.factoryCustomer.update({ where: { id: customer.id }, data: updateData });

              // Send onboarding email
              if (result.success && customer.email) {
                await emailService.sendFactoryCustomerOnboarding(customer.email, {
                  contactName: customer.companyName,
                  productName: customer.industry === 'home_care' ? 'Twomiah Care' : 'Twomiah Build',
                  loginEmail: customer.email,
                  tempPassword: customer.adminPassword || 'Check your welcome email',
                  crmUrl: result.deployedUrl || null,
                  cmsUrl: result.siteUrl || null,
                  siteUrl: result.siteUrl || null,
                });
              }

              logger.info(`[Public Signup] Auto-deploy complete for ${customer.companyName}`);
            } catch (deployErr) {
              logger.error(`[Public Signup] Auto-deploy failed for ${customer.slug}:`, deployErr.message);
              await prisma.factoryCustomer.update({
                where: { id: customerId },
                data: { status: 'generated', notes: `Auto-deploy failed: ${deployErr.message}` },
              }).catch(() => {});
            }
          });
        }
      }
    }

    const result = await factoryStripe.handleWebhookEvent(event, prisma);
    res.json({ received: true, result });
  } catch (err) {
    logger.error('[Factory Webhook] Handler error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Pricing Plans ─────────────────────────────────────────────────────────────

router.get('/plans', (req, res) => {
  res.json({
    plans: [
      {
        id: 'starter',
        name: 'Starter',
        description: 'CRM only — perfect for getting organized',
        monthlyPrice: 97,
        yearlyPrice: 970,
        includes: ['crm'],
        features: [
          'Full CRM (contacts, jobs, invoices, quotes)',
          'Mobile app access',
          'Email notifications',
          'Up to 3 team members',
          'Email support',
        ],
      },
      {
        id: 'professional',
        name: 'Professional',
        description: 'CRM + Website — the complete package',
        monthlyPrice: 197,
        yearlyPrice: 1970,
        includes: ['crm', 'website', 'cms'],
        popular: true,
        features: [
          'Everything in Starter',
          'Professional website',
          'Website content manager',
          'Lead capture forms',
          'SEO-optimized pages',
          'Up to 10 team members',
          'Priority support',
        ],
      },
      {
        id: 'growth',
        name: 'Growth',
        description: 'Professional + marketing automation',
        monthlyPrice: 297,
        yearlyPrice: 2970,
        includes: ['crm', 'website', 'cms', 'paid_ads'],
        features: [
          'Everything in Professional',
          'Google Ads management',
          'Facebook Ads management',
          'Call tracking',
          'Monthly performance reports',
          'Unlimited team members',
          'Dedicated account manager',
        ],
      },
    ],
  });
});

export default router;
