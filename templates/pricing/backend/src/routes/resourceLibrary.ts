import { Hono } from 'hono';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../../db/index';
import { resourceLibraryItem } from '../../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { authenticate, requireManager } from '../middleware/auth';
import { parseBody, nameSchema } from '../utils/validation';
import { NotFoundError } from '../utils/errors';
import { uploadFile, deleteFile } from '../services/r2';
import { logger } from '../services/logger';

const app = new Hono();

app.use('*', authenticate);

// GET /
app.get('/', async (c) => {
  const authUser = c.get('user');
  const productId = c.req.query('productId');

  const conditions: any[] = [eq(resourceLibraryItem.companyId, authUser.companyId)];
  if (productId) {
    conditions.push(eq((resourceLibraryItem as any).productId, productId));
  }

  const items = await db
    .select()
    .from(resourceLibraryItem)
    .where(and(...conditions))
    .orderBy(asc(resourceLibraryItem.name));

  return c.json({ resources: items });
});

// POST / — upload file and create record
app.post('/', requireManager, async (c) => {
  const authUser = c.get('user');

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  const name = (formData.get('name') as string) || '';
  const description = (formData.get('description') as string) || '';
  const productId = (formData.get('productId') as string) || null;
  const resourceType = (formData.get('resourceType') as string) || 'document';

  if (!file) {
    return c.json({ error: 'File is required' }, 400);
  }
  if (!name) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const fileExtension = file.name.split('.').pop() || 'bin';
  const r2Key = `resources/${authUser.companyId}/${createId()}.${fileExtension}`;

  try {
    const fileUrl = await uploadFile(r2Key, fileBuffer, file.type);

    const id = createId();
    await db.insert(resourceLibraryItem).values({
      id,
      companyId: authUser.companyId,
      name,
      description: description || null,
      productId,
      resourceType,
      fileUrl,
      fileKey: r2Key,
      fileName: file.name,
      fileSize: String(file.size),
      mimeType: file.type,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return c.json({ id, fileUrl, message: 'Resource uploaded' }, 201);
  } catch (err) {
    logger.error('Resource upload failed', { error: (err as Error).message });
    return c.json({ error: 'Upload failed' }, 500);
  }
});

// DELETE /:id
app.delete('/:id', requireManager, async (c) => {
  const authUser = c.get('user');
  const resourceId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(resourceLibraryItem)
    .where(
      and(
        eq(resourceLibraryItem.id, resourceId),
        eq(resourceLibraryItem.companyId, authUser.companyId)
      )
    )
    .limit(1);

  if (!existing) throw new NotFoundError('Resource');

  const existingData = existing as any;

  // Delete from R2
  if (existingData.fileKey) {
    try {
      await deleteFile(existingData.fileKey);
    } catch (err) {
      logger.warn('Failed to delete file from R2', {
        error: (err as Error).message,
        key: existingData.fileKey,
      });
    }
  }

  // Delete from DB
  await db.delete(resourceLibraryItem).where(eq(resourceLibraryItem.id, resourceId));

  return c.json({ message: 'Resource deleted' });
});

export default app;
