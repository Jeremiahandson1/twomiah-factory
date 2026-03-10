import { Hono } from 'hono';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../../db/index';
import { contractTemplate } from '../../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { authenticate, requireManager } from '../middleware/auth';
import { parseBody, nameSchema } from '../utils/validation';
import { NotFoundError } from '../utils/errors';

const app = new Hono();

app.use('*', authenticate);

// GET /templates
app.get('/templates', async (c) => {
  const authUser = c.get('user');

  const templates = await db
    .select()
    .from(contractTemplate)
    .where(eq(contractTemplate.companyId, authUser.companyId))
    .orderBy(asc(contractTemplate.name));

  return c.json({ templates });
});

// POST /templates
const createTemplateSchema = z.object({
  name: nameSchema,
  content: z.string().min(1).max(50000),
  description: z.string().max(1000).optional().nullable(),
  isDefault: z.boolean().default(false),
});

app.post('/templates', requireManager, async (c) => {
  const authUser = c.get('user');
  const body = parseBody(createTemplateSchema, await c.req.json());

  // If this is set as default, unset other defaults
  if (body.isDefault) {
    await db
      .update(contractTemplate)
      .set({ isDefault: false })
      .where(eq(contractTemplate.companyId, authUser.companyId));
  }

  const id = createId();
  await db.insert(contractTemplate).values({
    id,
    companyId: authUser.companyId,
    name: body.name,
    content: body.content,
    description: body.description || null,
    isDefault: body.isDefault,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.json({ id, message: 'Contract template created' }, 201);
});

// PUT /templates/:id
const updateTemplateSchema = z.object({
  name: nameSchema.optional(),
  content: z.string().min(1).max(50000).optional(),
  description: z.string().max(1000).optional().nullable(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

app.put('/templates/:id', requireManager, async (c) => {
  const authUser = c.get('user');
  const templateId = c.req.param('id');
  const body = parseBody(updateTemplateSchema, await c.req.json());

  const [existing] = await db
    .select()
    .from(contractTemplate)
    .where(
      and(
        eq(contractTemplate.id, templateId),
        eq(contractTemplate.companyId, authUser.companyId)
      )
    )
    .limit(1);

  if (!existing) throw new NotFoundError('Contract template');

  if (body.isDefault) {
    await db
      .update(contractTemplate)
      .set({ isDefault: false })
      .where(eq(contractTemplate.companyId, authUser.companyId));
  }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.content !== undefined) updates.content = body.content;
  if (body.description !== undefined) updates.description = body.description;
  if (body.isDefault !== undefined) updates.isDefault = body.isDefault;
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  await db
    .update(contractTemplate)
    .set(updates)
    .where(eq(contractTemplate.id, templateId));

  return c.json({ message: 'Contract template updated' });
});

// GET /templates/:id/preview
app.get('/templates/:id/preview', async (c) => {
  const authUser = c.get('user');
  const templateId = c.req.param('id');

  const [tmpl] = await db
    .select()
    .from(contractTemplate)
    .where(
      and(
        eq(contractTemplate.id, templateId),
        eq(contractTemplate.companyId, authUser.companyId)
      )
    )
    .limit(1);

  if (!tmpl) throw new NotFoundError('Contract template');

  const tmplData = tmpl as any;
  let preview = tmplData.content || '';

  // Populate with sample data
  preview = preview
    .replace(/\{\{customerName\}\}/g, 'John Smith')
    .replace(/\{\{customerAddress\}\}/g, '123 Main Street')
    .replace(/\{\{customerCity\}\}/g, 'Springfield')
    .replace(/\{\{customerState\}\}/g, 'IL')
    .replace(/\{\{customerZip\}\}/g, '62704')
    .replace(/\{\{quoteNumber\}\}/g, 'Q-SAMPLE001')
    .replace(/\{\{totalPrice\}\}/g, '$15,000.00')
    .replace(/\{\{date\}\}/g, new Date().toLocaleDateString('en-US'))
    .replace(/\{\{companyName\}\}/g, 'Sample Company');

  return c.json({
    preview,
    templateName: tmplData.name,
  });
});

export default app;
