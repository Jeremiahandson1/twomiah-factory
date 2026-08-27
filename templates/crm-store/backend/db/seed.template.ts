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

  // ── Owner login ──
  // Seed runs on EVERY boot, so it must never overwrite the owner's password:
  // doing so reset a merchant's chosen password to the generation-time value on
  // every restart/redeploy (and silently changed the login when a tenant was
  // regenerated without the original password). Set the hash only when creating
  // the owner; for an existing owner just keep role/active and leave the
  // password they own. Password recovery is the Forgot-password flow.
  const passwordHash = '{{HASHED_DEFAULT_PASSWORD}}' // bcrypt hash injected at generation — plaintext never touches the repo
  const [existingUser] = await db.select().from(users).where(eq(users.email, '{{ADMIN_EMAIL}}')).limit(1)
  if (existingUser) {
    await db.update(users).set({ role: 'owner', isActive: true }).where(eq(users.id, existingUser.id))
    console.log('Owner login present — password left as the owner set it')
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
    const samplePlaceholderImg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPSc5MDAnIGhlaWdodD0nOTAwJyB2aWV3Qm94PScwIDAgOTAwIDkwMCc+PHJlY3Qgd2lkdGg9JzkwMCcgaGVpZ2h0PSc5MDAnIGZpbGw9JyNlZWYxZjQnLz48ZyBmaWxsPSdub25lJyBzdHJva2U9JyNhYWI2YzQnIHN0cm9rZS13aWR0aD0nMTInIHN0cm9rZS1saW5lam9pbj0ncm91bmQnPjxwYXRoIGQ9J00zMjAgMzcyIEw0NTAgMzAwIEw1ODAgMzcyIEw1ODAgNTQwIEw0NTAgNjEyIEwzMjAgNTQwIFonLz48cGF0aCBkPSdNMzIwIDM3MiBMNDUwIDQ0NCBMNTgwIDM3MicvPjxwYXRoIGQ9J000NTAgNDQ0IEw0NTAgNjEyJy8+PC9nPjx0ZXh0IHg9JzQ1MCcgeT0nNzAwJyBmb250LWZhbWlseT0nQXJpYWwsIEhlbHZldGljYSwgc2Fucy1zZXJpZicgZm9udC1zaXplPSc0NCcgZmlsbD0nIzdiODg5NCcgdGV4dC1hbmNob3I9J21pZGRsZSc+U2FtcGxlIHByb2R1Y3Q8L3RleHQ+PC9zdmc+'
    const demos = [
      { slug: 'sample-product-one', name: 'Sample Product One', priceCents: 2500, sku: 'SAMPLE-1', img: samplePlaceholderImg },
      { slug: 'sample-product-two', name: 'Sample Product Two', priceCents: 4000, sku: 'SAMPLE-2', img: samplePlaceholderImg },
      { slug: 'sample-product-three', name: 'Sample Product Three', priceCents: 6000, sku: 'SAMPLE-3', img: samplePlaceholderImg },
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
