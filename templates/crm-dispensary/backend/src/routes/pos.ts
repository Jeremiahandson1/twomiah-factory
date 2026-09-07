import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// Raw db.execute rows are snake_case; the POS/scanner UIs read camelCase.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// POST /cart/add — Resolve a product for the POS cart. The register keeps its cart in
// client state, so this validates the product is real, in stock, and belongs to the
// company, then returns the product to add. The QR Scanner "Add to cart" action uses it.
app.post('/cart/add', async (c) => {
  const currentUser = c.get('user') as any

  const body = await c.req.json().catch(() => ({}))
  const parsed = z.object({
    productId: z.string().min(1),
    quantity: z.coerce.number().int().positive().default(1),
  }).safeParse(body)
  if (!parsed.success) return c.json({ error: 'productId is required' }, 400)

  const result = await db.execute(sql`
    SELECT id, name, price, sale_price, in_stock, stock_quantity, image_url
    FROM products
    WHERE id = ${parsed.data.productId} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const product = ((result as any).rows || result)?.[0]
  if (!product) return c.json({ error: 'Product not found' }, 404)
  if (product.in_stock === false) return c.json({ error: 'Product is out of stock' }, 400)

  const unitPrice = Number(product.sale_price ?? product.price ?? 0)
  return c.json({
    success: true,
    quantity: parsed.data.quantity,
    unitPrice,
    lineTotal: Number((unitPrice * parsed.data.quantity).toFixed(2)),
    product: camel(product),
  })
})

export default app
