import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.ts';
import { requirePermission } from '../middleware/permissions.ts';
import warranties from '../services/warranties.ts';

const app = new Hono();
app.use('*', authenticate);

// ============================================
// TEMPLATES
// ============================================

app.get('/templates', async (c) => {
  const user = c.get('user') as any;
  const templates = await warranties.getWarrantyTemplates(user.companyId);
  return c.json(templates);
});

app.post('/templates', requirePermission('warranties:create'), async (c) => {
  const user = c.get('user') as any;
  const body = await c.req.json();
  const template = await warranties.createWarrantyTemplate(user.companyId, body);
  return c.json(template, 201);
});

app.post('/templates/seed', requirePermission('warranties:create'), async (c) => {
  const user = c.get('user') as any;
  await warranties.seedDefaultTemplates(user.companyId);
  return c.json({ success: true });
});

// ============================================
// WARRANTIES
// ============================================

// Get active warranties
app.get('/', async (c) => {
  const user = c.get('user') as any;
  const expiringSoon = c.req.query('expiringSoon');
  const contactId = c.req.query('contactId');
  const page = c.req.query('page');
  const limit = c.req.query('limit');
  const data = await warranties.getActiveWarranties(user.companyId, {
    expiringSoon: expiringSoon === 'true',
    contactId,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 50,
  });
  return c.json(data);
});

// Get stats
app.get('/stats', async (c) => {
  const user = c.get('user') as any;
  const stats = await warranties.getWarrantyStats(user.companyId);
  return c.json(stats);
});

// Get expiring warranties
app.get('/expiring', async (c) => {
  const user = c.get('user') as any;
  const days = c.req.query('days');
  const data = await warranties.getExpiringWarranties(user.companyId, {
    days: parseInt(days as string) || 30,
  });
  return c.json(data);
});

// Get warranties for a project
app.get('/project/:projectId', async (c) => {
  const user = c.get('user') as any;
  const data = await warranties.getProjectWarranties(c.req.param('projectId'), user.companyId);
  return c.json(data);
});

// Create warranty
app.post('/', requirePermission('warranties:create'), async (c) => {
  const user = c.get('user') as any;
  const body = await c.req.json();
  const warranty = await warranties.createProjectWarranty(user.companyId, body);
  return c.json(warranty, 201);
});

// Create warranties from templates
app.post('/from-templates', requirePermission('warranties:create'), async (c) => {
  const user = c.get('user') as any;
  const { projectId, contactId, startDate, templateIds } = await c.req.json();
  const created = await warranties.createWarrantiesFromTemplates(
    user.companyId,
    projectId,
    contactId,
    startDate,
    templateIds
  );
  return c.json(created, 201);
});

// ============================================
// CLAIMS
// ============================================

// Get all claims
app.get('/claims', async (c) => {
  const user = c.get('user') as any;
  const warrantyId = c.req.query('warrantyId');
  const projectId = c.req.query('projectId');
  const status = c.req.query('status');
  const priority = c.req.query('priority');
  const page = c.req.query('page');
  const limit = c.req.query('limit');
  const data = await warranties.getClaims(user.companyId, {
    warrantyId,
    projectId,
    status,
    priority,
    page: parseInt(page as string) || 1,
    limit: parseInt(limit as string) || 50,
  });
  return c.json(data);
});

// Get single claim
app.get('/claims/:id', async (c) => {
  const user = c.get('user') as any;
  const claim = await warranties.getClaim(c.req.param('id'), user.companyId);
  if (!claim) return c.json({ error: 'Claim not found' }, 404);
  return c.json(claim);
});

// Create claim
app.post('/claims', async (c) => {
  const user = c.get('user') as any;
  const body = await c.req.json();
  const claim = await warranties.createClaim(user.companyId, {
    ...body,
    reportedBy: user.userId,
  });
  return c.json(claim, 201);
});

// Update claim status
app.put('/claims/:id/status', requirePermission('warranties:update'), async (c) => {
  const user = c.get('user') as any;
  const body = await c.req.json();
  const claim = await warranties.updateClaimStatus(c.req.param('id'), user.companyId, {
    ...body,
    userId: user.userId,
  });
  return c.json(claim);
});

// Schedule warranty work
app.post('/claims/:id/schedule', requirePermission('warranties:update'), async (c) => {
  const user = c.get('user') as any;
  const body = await c.req.json();
  const job = await warranties.scheduleWarrantyWork(c.req.param('id'), user.companyId, body);
  return c.json(job, 201);
});

// Deny claim
app.post('/claims/:id/deny', requirePermission('warranties:update'), async (c) => {
  const user = c.get('user') as any;
  const body = await c.req.json();
  const claim = await warranties.denyClaim(c.req.param('id'), user.companyId, {
    reason: body.reason,
    userId: user.userId,
  });
  return c.json(claim);
});

// ============================================
// REPORTS
// ============================================

app.get('/reports/by-category', async (c) => {
  const user = c.get('user') as any;
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const data = await warranties.getClaimsByCategory(user.companyId, {
    startDate,
    endDate,
  });
  return c.json(data);
});

export default app;
