import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.ts';
import { requirePermission } from '../middleware/permissions.ts';
import takeoffs from '../services/takeoffs.ts';

const app = new Hono();
app.use('*', authenticate);

// ============================================
// ASSEMBLIES
// ============================================

app.get('/assemblies', async (c) => {
  const user = c.get('user') as any;
  const category = c.req.query('category');
  const active = c.req.query('active');
  const assemblies = await takeoffs.getAssemblies(user.companyId, {
    category,
    active: active === 'false' ? false : active === 'all' ? null : true,
  });
  return c.json(assemblies);
});

app.get('/assemblies/:id', async (c) => {
  const user = c.get('user') as any;
  const assembly = await takeoffs.getAssembly(c.req.param('id'), user.companyId);
  if (!assembly) return c.json({ error: 'Assembly not found' }, 404);
  return c.json(assembly);
});

app.post('/assemblies', requirePermission('takeoffs:create'), async (c) => {
  const user = c.get('user') as any;
  const body = await c.req.json();
  const assembly = await takeoffs.createAssembly(user.companyId, body);
  return c.json(assembly, 201);
});

app.put('/assemblies/:id', requirePermission('takeoffs:update'), async (c) => {
  const user = c.get('user') as any;
  const body = await c.req.json();
  await takeoffs.updateAssembly(c.req.param('id'), user.companyId, body);
  return c.json({ success: true });
});

app.post('/assemblies/seed', requirePermission('takeoffs:create'), async (c) => {
  const user = c.get('user') as any;
  await takeoffs.seedDefaultAssemblies(user.companyId);
  return c.json({ success: true });
});

// ============================================
// TAKEOFF SHEETS
// ============================================

app.get('/project/:projectId', async (c) => {
  const user = c.get('user') as any;
  const sheets = await takeoffs.getProjectTakeoffs(c.req.param('projectId'), user.companyId);
  return c.json(sheets);
});

app.get('/sheets/:id', async (c) => {
  const user = c.get('user') as any;
  const sheet = await takeoffs.getTakeoffSheet(c.req.param('id'), user.companyId);
  if (!sheet) return c.json({ error: 'Sheet not found' }, 404);
  return c.json(sheet);
});

app.post('/project/:projectId', requirePermission('takeoffs:create'), async (c) => {
  const user = c.get('user') as any;
  const body = await c.req.json();
  const sheet = await takeoffs.createTakeoffSheet(user.companyId, {
    ...body,
    projectId: c.req.param('projectId'),
  });
  return c.json(sheet, 201);
});

// ============================================
// TAKEOFF ITEMS
// ============================================

app.post('/sheets/:sheetId/items', requirePermission('takeoffs:create'), async (c) => {
  const user = c.get('user') as any;
  const body = await c.req.json();
  const item = await takeoffs.addTakeoffItem(c.req.param('sheetId'), user.companyId, body);
  return c.json(item, 201);
});

app.put('/items/:id', requirePermission('takeoffs:update'), async (c) => {
  const user = c.get('user') as any;
  const body = await c.req.json();
  const item = await takeoffs.updateTakeoffItem(c.req.param('id'), user.companyId, body);
  return c.json(item);
});

app.delete('/items/:id', requirePermission('takeoffs:delete'), async (c) => {
  const user = c.get('user') as any;
  await takeoffs.deleteTakeoffItem(c.req.param('id'), user.companyId);
  return c.json({ success: true });
});

// ============================================
// TOTALS
// ============================================

app.get('/sheets/:id/totals', async (c) => {
  const user = c.get('user') as any;
  const totals = await takeoffs.getSheetMaterialTotals(c.req.param('id'), user.companyId);
  return c.json(totals);
});

app.get('/project/:projectId/totals', async (c) => {
  const user = c.get('user') as any;
  const totals = await takeoffs.getProjectMaterialTotals(c.req.param('projectId'), user.companyId);
  return c.json(totals);
});

// ============================================
// EXPORT
// ============================================

app.post('/sheets/:id/export-po', requirePermission('takeoffs:create'), async (c) => {
  const user = c.get('user') as any;
  const { vendorId } = await c.req.json();
  const po = await takeoffs.exportToPurchaseOrder(c.req.param('id'), user.companyId, { vendorId });
  return c.json(po, 201);
});

export default app;
