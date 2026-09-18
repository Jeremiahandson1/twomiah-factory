/**
 * Rebuild the 10 "ZZ Fleet" test tenants through the LIVE production path:
 * POST /public/signup (5/hr/IP rate limit → run in two batches), then the
 * comp-promo checkout (COMP_PROMO_CODE) which marks is_test_tenant and fires
 * the same triggerAutoDeploy a real payment would.
 *
 *   cd apps/api && COMP_PROMO_CODE=... ADMIN_JWT=... bun run scripts/rebuild-zz-fleet.ts --batch=1
 *   cd apps/api && COMP_PROMO_CODE=... ADMIN_JWT=... bun run scripts/rebuild-zz-fleet.ts --batch=2
 */
const API = 'https://twomiah-factory-api.onrender.com/api/v1/factory'
const COMP = (process.env.COMP_PROMO_CODE || '').trim()
const JWT = (process.env.ADMIN_JWT || '').trim()
const PASSWORD = 'Fleet-Test-7291!'

if (!COMP) { console.error('COMP_PROMO_CODE env required'); process.exit(1) }
if (!JWT) { console.error('ADMIN_JWT env required'); process.exit(1) }

type Fleet = { slug: string; tag: string; industry: string; label: string }
const BATCH1: Fleet[] = [
  { slug: 'zz-fleet-roofing', tag: 'roofing', industry: 'roofing', label: 'roofing' },
  { slug: 'zz-fleet-wrench', tag: 'wrench', industry: 'hvac', label: 'hvac' },
  { slug: 'zz-fleet-care', tag: 'care', industry: 'home_care', label: 'home care' },
  { slug: 'zz-fleet-leaf', tag: 'leaf', industry: 'dispensary', label: 'dispensary' },
  { slug: 'zz-fleet-lawn', tag: 'lawn', industry: 'landscaping', label: 'landscaping' },
]
const BATCH2: Fleet[] = [
  { slug: 'zz-fleet-build', tag: 'build', industry: 'general_contractor', label: 'general contractor' },
  { slug: 'zz-fleet-rv', tag: 'rv', industry: 'rv', label: 'rv' },
  { slug: 'zz-fleet-vet', tag: 'vet', industry: 'veterinary', label: 'veterinary' },
  { slug: 'zz-fleet-drive', tag: 'drive', industry: 'automotive', label: 'automotive' },
  { slug: 'zz-fleet-shop', tag: 'shop', industry: 'store', label: 'store' },
]
const batch = process.argv.includes('--batch=2') ? BATCH2 : BATCH1

for (const f of batch) {
  const body = {
    name: `ZZ Fleet ${f.label}`,
    slug: f.slug,
    email: `twomiah14+${f.tag}@gmail.com`,
    admin_email: `twomiah14+${f.tag}@gmail.com`,
    industry: f.industry,
    city: 'Eau Claire',
    state: 'WI',
    plan: 'starter10',
    products: ['crm', 'website'],
    admin_password: PASSWORD,
    primary_color: '#FF3D00',
  }
  const res = await fetch(`${API}/public/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok || !j.tenantId) {
    console.error(`SIGNUP FAIL ${f.slug}: HTTP ${res.status} ${JSON.stringify(j).slice(0, 200)}`)
    continue
  }
  console.log(`signup ok  ${f.slug}  tenant=${j.tenantId}`)

  // Comp checkout — no charge, flags is_test_tenant, fires the deploy.
  const comp = await fetch(`${API}/customers/${j.tenantId}/checkout/subscription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + JWT },
    body: JSON.stringify({ planId: 'starter10', promoCode: COMP }),
  })
  const cj: any = await comp.json().catch(() => ({}))
  if (comp.ok && cj.comp) console.log(`comp ok    ${f.slug}  deploying`)
  else console.error(`COMP FAIL  ${f.slug}: HTTP ${comp.status} ${JSON.stringify(cj).slice(0, 200)}`)
}
console.log('batch done')
