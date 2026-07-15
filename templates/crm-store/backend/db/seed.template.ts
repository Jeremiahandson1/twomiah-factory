import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import { storeSettings, users, products, productVariants } from './schema.ts'

// Idempotent seed — runs on every deploy. Creates the store's settings row, the
// owner login, and (only if the catalog is empty) one draft demo product the
// merchant can edit or delete. Never overwrites merchant edits.
const db = drizzle(process.env.DATABASE_URL!)

async function main() {
  console.log('Setting up {{COMPANY_NAME}} store...')

  // ── Store settings (one row) ──
  const [existingSettings] = await db.select().from(storeSettings).limit(1)
  if (!existingSettings) {
    await db.insert(storeSettings).values({
      companyName: '{{COMPANY_NAME}}',
      supportEmail: '{{COMPANY_EMAIL}}',
      currency: 'usd',
      flatShippingCents: 0,
      taxRateBps: 0,
      storefrontOrigin: '{{SITE_URL}}',
    })
    console.log('Created store settings')
  }

  // ── Owner login (always re-hash so credentials match the generated password) ──
  const passwordHash = await Bun.password.hash('{{DEFAULT_PASSWORD}}', 'bcrypt')
  const [existingUser] = await db.select().from(users).where(eq(users.email, '{{ADMIN_EMAIL}}')).limit(1)
  if (existingUser) {
    await db.update(users).set({ passwordHash, role: 'owner', isActive: true }).where(eq(users.id, existingUser.id))
    console.log('Updated owner login')
  } else {
    await db.insert(users).values({
      email: '{{ADMIN_EMAIL}}',
      passwordHash,
      name: '{{OWNER_FIRST_NAME}} {{OWNER_LAST_NAME}}',
      role: 'owner',
    })
    console.log('Created owner login')
  }

  // ── Demo product (only when the catalog is empty) ──
  const [anyProduct] = await db.select().from(products).limit(1)
  if (!anyProduct) {
    const [demo] = await db.insert(products).values({
      slug: 'sample-product',
      name: 'Sample Product',
      tagline: 'Edit or delete this example to build your catalog',
      description: 'This is a demo product created automatically. Open it in your admin to change the name, price, photos, and details — or delete it and add your own.',
      status: 'draft',
      featured: false,
      position: 0,
    }).returning()
    await db.insert(productVariants).values({
      productId: demo.id,
      sku: 'SAMPLE-001',
      name: 'Default',
      priceCents: 2500,
      inventoryQty: 10,
      position: 0,
    })
    console.log('Created demo product')
  }

  console.log('')
  console.log('Store admin login:')
  console.log('  Email: {{ADMIN_EMAIL}}')
  console.log('  Password: {{DEFAULT_PASSWORD}}')
}

main().catch((e) => { console.error(e); process.exit(1) })
