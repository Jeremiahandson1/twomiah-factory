import { Hono } from 'hono';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../../db/index';
import { product, priceRange, productCategory, pricebookImport } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { authenticate, requireManager } from '../middleware/auth';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../services/logger';

const app = new Hono();

app.use('*', authenticate);
app.use('*', requireManager);

// Helper: parse CSV string
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }

  return rows;
}

// POST /pricebook — upload CSV, parse, validate, import
app.post('/pricebook', async (c) => {
  const authUser = c.get('user');

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return c.json({ error: 'File is required' }, 400);
  }

  const text = await file.text();
  const rows = parseCSV(text);

  if (rows.length === 0) {
    return c.json({ error: 'File is empty or has no data rows' }, 400);
  }

  // Validate required columns
  const requiredColumns = [
    'categoryName',
    'productName',
    'measurementType',
    'tier',
    'minValue',
    'maxValue',
    'parPrice',
    'retailPrice',
  ];

  const headers = Object.keys(rows[0]);
  const missingColumns = requiredColumns.filter((col) => !headers.includes(col));
  if (missingColumns.length > 0) {
    return c.json(
      { error: `Missing required columns: ${missingColumns.join(', ')}` },
      400
    );
  }

  // Create import record
  const importId = createId();
  await db.insert(pricebookImport).values({
    id: importId,
    companyId: authUser.companyId,
    fileName: file.name,
    rowCount: rows.length,
    status: 'processing',
    importedBy: authUser.userId,
    createdAt: new Date(),
  });

  let imported = 0;
  let errors: string[] = [];

  try {
    // Group by product
    const productMap = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.categoryName}|${row.productName}`;
      if (!productMap.has(key)) productMap.set(key, []);
      productMap.get(key)!.push(row);
    }

    for (const [key, productRows] of productMap) {
      const [categoryName, productName] = key.split('|');
      const firstRow = productRows[0];

      try {
        // Find or create category
        let [cat] = await db
          .select()
          .from(productCategory)
          .where(
            and(
              eq(productCategory.companyId, authUser.companyId),
              eq(productCategory.name, categoryName)
            )
          )
          .limit(1);

        if (!cat) {
          const catId = createId();
          await db.insert(productCategory).values({
            id: catId,
            companyId: authUser.companyId,
            name: categoryName,
            isActive: true,
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          cat = { id: catId } as any;
        }

        // Find or create product
        let [prod] = await db
          .select()
          .from(product)
          .where(
            and(
              eq(product.companyId, authUser.companyId),
              eq(product.name, productName),
              eq(product.categoryId, (cat as any).id)
            )
          )
          .limit(1);

        if (!prod) {
          const prodId = createId();
          await db.insert(product).values({
            id: prodId,
            companyId: authUser.companyId,
            categoryId: (cat as any).id,
            name: productName,
            measurementType: firstRow.measurementType || 'count',
            isActive: true,
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          prod = { id: prodId } as any;
        }

        // Insert price ranges
        for (const row of productRows) {
          await db.insert(priceRange).values({
            id: createId(),
            companyId: authUser.companyId,
            productId: (prod as any).id,
            tier: row.tier || 'good',
            minValue: row.minValue || '0',
            maxValue: row.maxValue || '999999',
            parPrice: row.parPrice || '0',
            retailPrice: row.retailPrice || '0',
            yr1MarkupPct: row.yr1MarkupPct || '0',
            day30MarkupPct: row.day30MarkupPct || '0',
            todayDiscountPct: row.todayDiscountPct || '0',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          imported++;
        }
      } catch (err) {
        errors.push(`Row ${key}: ${(err as Error).message}`);
      }
    }

    // Update import record
    await db
      .update(pricebookImport)
      .set({
        status: errors.length > 0 ? 'completed_with_errors' : 'completed',
        importedCount: imported,
        errorCount: errors.length,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
        completedAt: new Date(),
      })
      .where(eq(pricebookImport.id, importId));

    return c.json({
      importId,
      imported,
      errors: errors.length,
      errorDetails: errors.slice(0, 20),
      message: `Imported ${imported} price ranges`,
    });
  } catch (err) {
    await db
      .update(pricebookImport)
      .set({
        status: 'failed',
        errors: JSON.stringify([(err as Error).message]),
        completedAt: new Date(),
      })
      .where(eq(pricebookImport.id, importId));

    logger.error('Pricebook import failed', { error: (err as Error).message });
    return c.json({ error: 'Import failed', details: (err as Error).message }, 500);
  }
});

// GET /template — download CSV template
app.get('/template', async (c) => {
  const csvTemplate = [
    'categoryName,productName,measurementType,tier,minValue,maxValue,parPrice,retailPrice,yr1MarkupPct,day30MarkupPct,todayDiscountPct',
    'Windows,Double Hung Window,united_inches,good,40,60,150.00,250.00,15,8,5',
    'Windows,Double Hung Window,united_inches,better,40,60,200.00,350.00,15,8,5',
    'Windows,Double Hung Window,united_inches,best,40,60,275.00,475.00,15,8,5',
  ].join('\n');

  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', 'attachment; filename="pricebook-import-template.csv"');
  return c.body(csvTemplate);
});

// POST /preview — parse file and return preview data
app.post('/preview', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return c.json({ error: 'File is required' }, 400);
  }

  const text = await file.text();
  const rows = parseCSV(text);

  if (rows.length === 0) {
    return c.json({ error: 'File is empty or has no data rows' }, 400);
  }

  const headers = Object.keys(rows[0]);
  const preview = rows.slice(0, 20);

  // Validate
  const requiredColumns = [
    'categoryName',
    'productName',
    'measurementType',
    'tier',
    'minValue',
    'maxValue',
    'parPrice',
    'retailPrice',
  ];
  const missingColumns = requiredColumns.filter((col) => !headers.includes(col));

  const uniqueCategories = [...new Set(rows.map((r) => r.categoryName).filter(Boolean))];
  const uniqueProducts = [...new Set(rows.map((r) => r.productName).filter(Boolean))];

  return c.json({
    headers,
    totalRows: rows.length,
    preview,
    missingColumns,
    isValid: missingColumns.length === 0,
    summary: {
      categories: uniqueCategories.length,
      products: uniqueProducts.length,
      priceRanges: rows.length,
    },
  });
});

export default app;
