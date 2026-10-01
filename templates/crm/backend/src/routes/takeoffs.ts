import { Hono } from 'hono';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.ts';
import { requirePermission } from '../middleware/permissions.ts';
import takeoffs from '../services/takeoffs.ts';

/**
 * What the INSERTs actually require.
 *
 * The services build raw SQL from the body with no default for these fields, and drizzle
 * interpolating `undefined` produces a malformed statement — so an empty body answered 500 "syntax
 * error at or near ','" instead of a 400. Only the fields the SQL has no fallback for are required;
 * the rest the services already default.
 */
const assemblyBody = z.object({ name: z.string().min(1, 'Name is required') }).passthrough();
const sheetBody = z.object({ name: z.string().min(1, 'Name is required') }).passthrough();
const itemBody = z.object({ assemblyId: z.string().min(1, 'Pick an assembly') }).passthrough();

const app = new Hono();
app.use('*', authenticate);
/**
 * Reads are checked against the matrix too — this is quantity takeoffs and their material cost. (T32 H1)
 *
 * Every write below has always been gated on `takeoffs:*`; the GETs were on `authenticate`
 * alone, so any signed-in user of the company could read them. The matrix already draws the line:
 * `takeoffs` sits with admin and manager, and `field` and `viewer` hold none of it.
 *
 * On the MOUNT rather than per handler, so the next GET added to this file is gated by
 * construction and cannot repeat the omission.
 */
app.use('*', requirePermission('takeoffs:read'));

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
  const body = assemblyBody.parse(await c.req.json().catch(() => ({})));
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
  const body = sheetBody.parse(await c.req.json().catch(() => ({})));
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
  const body = itemBody.parse(await c.req.json().catch(() => ({})));
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
  // A sheet that is not there is a 404, the same as every other door to a sheet in this file.
  // getSheetMaterialTotals THROWS 'Sheet not found', and this handler let that become a 500 — so
  // asking for the totals of a deleted or mistyped sheet reported a server fault.
  const sheet = await takeoffs.getTakeoffSheet(c.req.param('id'), user.companyId);
  if (!sheet) return c.json({ error: 'Sheet not found' }, 404);
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
