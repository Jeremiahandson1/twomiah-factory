// Boots the real unified app on an in-memory database with a small, clearly-fake contractor so the public site can be looked
// at in a browser. Not a test, not a deploy: nothing is sent anywhere.
//   cd apps/unified && bun ../../docs/site-sections/tools/serve-site.ts [port]
// Control (local only):  GET /__design/<foundry|heritage|studio|market>    switch the look
//                        POST /__page/<slug>   body {"sections":[…], "title":"…"}  replace a page's sections (creates it)
//                        POST /__set           body {"website":{…}, "company":{…}}  change settings / company columns
import path from 'node:path'
import { bootTenant } from '../../../apps/unified/tests/harness.ts'

const port = Number(process.argv[2] || 4320)
const t = await bootTenant({ vertical: 'contractor' })
const S = t.schema
const [co] = await t.db.insert(S.company).values({
  name: 'Westridge Builders', slug: 'westridge', email: 'hello@westridge.example', phone: '(608) 555-0142',
  address: '12 Main St', city: 'Verona', state: 'WI', zip: '53593', primaryColor: '#b45309', enabledFeatures: [],
}).returning()
await t.db.insert(S.website).values({ companyId: co.id, design: 'foundry', tagline: 'Custom homes and renovations', nav: [{ label: 'Services', href: 'services' }, { label: 'Contact', href: 'contact' }], serviceAreas: ['Verona', 'Madison'] })
await t.db.insert(S.page).values({ companyId: co.id, slug: 'home', title: 'Home', sections: [], isPublished: true })

const eq = (await import('../../../apps/unified/node_modules/drizzle-orm/index.js')).eq
Bun.serve({
  port, async fetch(req) {
    const u = new URL(req.url)
    if (u.pathname.startsWith('/__design/')) { await t.db.update(S.website).set({ design: u.pathname.split('/')[2] }).where(eq(S.website.companyId, co.id)); return new Response('ok') }
    if (u.pathname === '/__set') {
      const b: any = await req.json()
      if (b.website) await t.db.update(S.website).set(b.website).where(eq(S.website.companyId, co.id))
      if (b.company) await t.db.update(S.company).set(b.company).where(eq(S.company.id, co.id))
      return new Response('ok')
    }
    if (u.pathname.startsWith('/__page/')) {
      const slug = u.pathname.split('/')[2]
      const b: any = await req.json()
      const have = await t.db.select().from(S.page).where(eq(S.page.slug, slug))
      if (have.length) await t.db.update(S.page).set({ sections: b.sections, title: b.title || have[0].title, isPublished: true }).where(eq(S.page.slug, slug))
      else await t.db.insert(S.page).values({ companyId: co.id, slug, title: b.title || slug, sections: b.sections, isPublished: true })
      return new Response('ok')
    }
    // Stand-in photographs for the screens: /__img/<n>.png (an SVG) is a plain tinted picture, never a claim about any work.
    if (u.pathname.startsWith('/__img/')) {
      const n = Number(u.pathname.split('/')[2].replace('.png', '')) || 1
      const hues = [28, 200, 140, 340, 260, 50]
      const h = hues[(n - 1) % hues.length]
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},35%,38%)"/><stop offset="1" stop-color="hsl(${h + 30},30%,20%)"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="880" cy="260" r="120" fill="hsla(${h},40%,80%,.25)"/><rect x="120" y="470" width="520" height="220" rx="10" fill="hsla(${h},30%,85%,.18)"/></svg>`
      return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } })
    }
    if (u.pathname === '/__sql') { const b: any = await req.json(); const r = await t.client.query(b.sql, b.params || []); return Response.json(r.rows) }
    return t.app.fetch(req)
  },
})
console.log('serving the site on http://localhost:' + port)
