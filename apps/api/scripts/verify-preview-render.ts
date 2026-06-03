// End-to-end render check: feed a minimal GenerateConfig at each of
// landscaping + showcase, run previewRenderer.renderHomepagePreview,
// then parse every JSON-LD block in the output to make sure none of them
// throw. This catches not just EJS syntax errors but also runtime issues
// in the JSON-LD blocks (unescaped quotes, broken templating, etc).
import { renderHomepagePreview } from '../src/services/previewRenderer'
import type { GenerateConfig } from '../src/services/generator'

function makeConfig(industry: string, name: string): GenerateConfig {
  return {
    products: ['website'],
    company: {
      name,
      industry,
      phone: '555-867-5309',
      email: 'hello@example.com',
      city: 'Madison',
      state: 'WI',
      stateFull: 'Wisconsin',
      address: '123 Main St',
      zip: '53703',
      nearbyCities: ['Madison', 'Verona', 'Sun Prairie'],
    },
    branding: {
      primaryColor: '#2563eb',
      secondaryColor: '#0f172a',
    },
    features: { website: [], crm: [] },
  }
}

const CASES: Array<{ industry: string; name: string; expectTemplate: string }> = [
  // landscaping → website-landscaping
  { industry: 'landscaping', name: 'Madison Lawn Pros', expectTemplate: 'website-landscaping' },
  // food is in SHOWCASE_INDUSTRIES → website-showcase
  { industry: 'food', name: 'Madison Bistro', expectTemplate: 'website-showcase' },
]

;(async () => {
  let pass = 0
  let fail = 0
  for (const c of CASES) {
    try {
      const result = await renderHomepagePreview(makeConfig(c.industry, c.name))
      const html = result.html

      // Extract every <script type="application/ld+json">…</script> and JSON.parse it.
      const blocks: string[] = []
      const re = /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(html))) blocks.push(m[1])
      let invalid = 0
      for (let i = 0; i < blocks.length; i++) {
        try { JSON.parse(blocks[i]) }
        catch (e: any) {
          invalid++
          console.log(`  JSON-LD block ${i + 1} FAILED to parse: ${e.message?.split('\n')[0]}`)
          const preview = blocks[i].slice(0, 240).replace(/\s+/g, ' ')
          console.log(`    head: ${preview}…`)
        }
      }
      const status = invalid === 0 ? 'OK' : 'FAIL'
      console.log(`${status} ${c.industry.padEnd(12)} → ${c.expectTemplate.padEnd(20)} html=${html.length}B ld+json=${blocks.length} invalid=${invalid}`)
      if (invalid === 0) pass++; else fail++
    } catch (err: any) {
      console.log(`FAIL ${c.industry.padEnd(12)} → ${c.expectTemplate.padEnd(20)} ${err && err.message ? err.message.split('\n')[0] : err}`)
      fail++
    }
  }
  console.log(`\n${pass}/${pass + fail} previews rendered + JSON-LD parses clean.`)
  process.exit(fail === 0 ? 0 : 1)
})()
