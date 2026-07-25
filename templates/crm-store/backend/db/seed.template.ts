import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import { storeSettings, users, products, productVariants, productImages } from './schema.ts'

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
  const passwordHash = '{{HASHED_DEFAULT_PASSWORD}}' // bcrypt hash injected at generation — plaintext never touches the repo
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

  // ── Demo catalog (only when empty) — ACTIVE sample products so the store is
  // not empty on day one. The merchant edits or deletes these in their admin.
  const [anyProduct] = await db.select().from(products).limit(1)
  if (!anyProduct) {
    const sampleNote = 'This is a sample product added automatically so your store is not empty. Edit its name, price, photos, and details in your admin — or delete it and add your own.'
    const demos = [
      { slug: 'signature-eau-de-parfum', name: 'Signature Eau de Parfum', priceCents: 4800, sku: 'SAMPLE-PARFUM', img: 'https://images.pexels.com/photos/27274783/pexels-photo-27274783.jpeg?auto=compress&cs=tinysrgb&w=900&h=900&fit=crop' },
      { slug: 'daily-hydrating-serum', name: 'Daily Hydrating Serum', priceCents: 3200, sku: 'SAMPLE-SERUM', img: 'https://images.pexels.com/photos/8015790/pexels-photo-8015790.jpeg?auto=compress&cs=tinysrgb&w=900&h=900&fit=crop' },
      { slug: 'skincare-essentials-set', name: 'Skincare Essentials Set', priceCents: 6500, sku: 'SAMPLE-SET', img: 'https://images.pexels.com/photos/34159010/pexels-photo-34159010.jpeg?auto=compress&cs=tinysrgb&w=900&h=900&fit=crop' },
    ]
    let pos = 0
    for (const d of demos) {
      const [p] = await db.insert(products).values({
        slug: d.slug,
        name: d.name,
        tagline: 'Sample product — edit or delete in your admin',
        description: sampleNote,
        status: 'active',
        featured: true,
        position: pos,
      }).returning()
      await db.insert(productVariants).values({
        productId: p.id, sku: d.sku, name: 'Default', priceCents: d.priceCents, inventoryQty: 25, position: 0,
      })
      await db.insert(productImages).values({
        productId: p.id, url: d.img, alt: d.name, isPrimary: true, position: 0,
      })
      pos++
    }
    console.log('Created ' + demos.length + ' sample products')
  }

  console.log('')
  console.log('Store admin login:')
  console.log('  Email: {{ADMIN_EMAIL}}')
  console.log('  Password: (set at signup — use Forgot password on the login page if lost)')
}

main().catch((e) => { console.error(e); process.exit(1) })
