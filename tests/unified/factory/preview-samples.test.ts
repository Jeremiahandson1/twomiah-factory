// The free preview is filled with clearly marked SAMPLE content (apps/api/src/config/previewSamples.ts) — and a real
// site must never carry any of it: a real site states only what its owner gave (FACTS_POLICY, sectionComposer.ts).
// Proved three ways: by marker (every sample section is marked; none appears in what the build makes), by text (no
// sample sentence is in what the build or the template composer makes), and by import (only the preview reads the file).
// No live API is called: the renderer is local and nothing is fetched.
import { test, expect, describe } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { SAMPLE_BANNER, SAMPLE_MARK, isSampleSection, withPreviewSamples } from '../../../apps/api/src/config/previewSamples'
import { provisionSite } from '../../../apps/api/src/unified/factory'
import { renderUnifiedPreview } from '../../../apps/api/src/unified/preview'
import { composeInstant } from '../../../apps/api/src/services/instantComposer'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')
const BASE = 'https://factory.example'

const TRADES: Array<[vertical: string, industry: string]> = [
  ['contractor', 'General Contractor'], ['roofing', 'Roofing'], ['homecare', 'Home Care'], ['salon', 'Hair Salon'],
  ['restaurant', 'Restaurant'], ['basic', 'Consulting'], ['store', 'Online Store'], ['fieldservice', 'Plumbing'], ['landscaping', 'Landscaping'],
]
const tenant = (industry: string) => ({ name: 'Acme Co', industry, city: 'Eau Claire', state: 'WI', primary_color: '#FF3D00', intake_data: {}, products: ['website'] })
const homeOf = (industry: string): any[] => (provisionSite(tenant(industry)) as any).pages.find((p: any) => p.slug === 'home').sections

/** Every string value in a structure. */
const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out))
  return out
}
const hasMark = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.some(hasMark)
  if (v && typeof v === 'object') return (v as any)[SAMPLE_MARK] === true || Object.values(v).some(hasMark)
  return false
}

describe('sample sections carry a marker, and the preview has them', () => {
  for (const [vertical, industry] of TRADES) {
    test(vertical + ': samples are marked, the real hero and call to action are not, and it reads as a fuller page', () => {
      const real = homeOf(industry)
      const { sections } = withPreviewSamples(real, vertical, BASE)
      const sampled = sections.filter(isSampleSection)
      expect(sampled.length).toBeGreaterThan(0)
      expect(sections.filter((s) => s.type === 'hero').every((s) => !isSampleSection(s))).toBe(true)
      expect(sections.filter((s) => s.type === 'cta').every((s) => !isSampleSection(s))).toBe(true)
      // A shop's samples fill its existing shop section; every other page gains sections.
      if (vertical === 'store') expect(sampled.map((x) => x.type)).toEqual(['shop'])
      else expect(sections.length).toBeGreaterThan(real.length)
      if (vertical !== 'store') {
        const types = sampled.map((s) => s.type)
        for (const t of ['services', 'about', 'testimonials', 'faq']) expect(types).toContain(t)
      }
      // The call to action stays last.
      expect(sections.at(-1).type).toBe('cta')
    })
  }

  test('a review is attributed "Sample review", never a person; prices and projects say Sample', () => {
    const salon = withPreviewSamples(homeOf('Hair Salon'), 'salon', BASE).sections
    const reviews = salon.find((s) => s.type === 'testimonials').data.items
    expect(reviews.length).toBeGreaterThan(0)
    for (const r of reviews) expect(r.author).toBe('Sample review')
    for (const p of salon.find((s) => s.type === 'pricing').data.items) expect(p.priceLabel).toMatch(/^Sample/)
    const roof = withPreviewSamples(homeOf('Roofing'), 'roofing', BASE).sections
    for (const g of roof.find((s) => s.type === 'gallery').data.photos) expect(g.caption).toMatch(/^Sample/)
    const store = withPreviewSamples(homeOf('Online Store'), 'store', BASE).sections.find((s) => s.type === 'shop').data.products
    expect(store.length).toBeGreaterThanOrEqual(6)
    for (const p of store) expect(p.tagline).toMatch(/^Sample/)
  })

  test('real photos only: every image is the Factory\'s stock or an Unsplash photo — and none when no library address is set', () => {
    for (const [vertical, industry] of TRADES) {
      const { sections, imageUrls } = withPreviewSamples(homeOf(industry), vertical, BASE)
      for (const u of imageUrls) expect(u).toMatch(new RegExp('^(' + BASE.replace(/\./g, '\\.') + '/hero-library/[a-z]+/[a-z]+-\\d+\\.jpg|https://images\\.unsplash\\.com/photo-[\\w-]+\\?)'))
      for (const u of strings(sections).filter((s) => /^https?:\/\//.test(s))) expect(imageUrls).toContain(u)
    }
    // No address: a section that needs library photos is left out, never drawn with a broken box.
    const none = withPreviewSamples(homeOf('Roofing'), 'roofing', '')
    expect(none.sections.some((s) => s.type === 'gallery')).toBe(false)
    expect(strings(none.sections).some((s) => s.includes('/hero-library/'))).toBe(false)
  })

  test('a real service list is never replaced', () => {
    const real = [
      { type: 'hero', variant: 'centered-stats', data: { title: 'Acme' } },
      { type: 'services', variant: 'cards-grid', data: { items: [{ title: 'Gutter cleaning' }] } },
      { type: 'cta', variant: 'banner', data: { heading: 'Call' } },
    ]
    const out = withPreviewSamples(real, 'contractor', BASE).sections
    expect(out.filter((s) => s.type === 'services')).toEqual([real[1]])
  })
})

describe('the preview page', () => {
  test('carries the banner and the samples; the same page without them (a real render) carries neither', async () => {
    const html = await renderUnifiedPreview({ businessName: 'Acme Co', businessType: 'Roofing', city: 'Eau Claire', state: 'WI', vertical: 'roofing', design: 'foundry' })
    expect(html).toContain('id="twomiah-sample-banner"')
    expect(html).toContain(SAMPLE_BANNER)
    expect(html).toContain('Sample review')
    // The banner is the first thing in the body.
    expect(html.replace(/\s+/g, ' ')).toMatch(/<body[^>]*><style>#twomiah-sample-banner/)
    const { renderSitePreview } = await import('../../../apps/unified/server/site/signupPreview')
    const real = await renderSitePreview({ vertical: 'roofing', design: 'foundry', company: { name: 'Acme Co', primaryColor: '#FF3D00' }, settings: {}, sections: homeOf('Roofing'), features: [] })
    expect(real).not.toContain('twomiah-sample-banner')
    expect(real).not.toContain('Sample review')
    expect(real).not.toContain('(sample')
  })
})

describe('a real site cannot carry a sample', () => {
  const sampleText = (vertical: string, industry: string) =>
    strings(withPreviewSamples(homeOf(industry), vertical, BASE).sections.filter(isSampleSection)).filter((s) => s.length > 12 && /sample/i.test(s))

  for (const [vertical, industry] of TRADES) {
    test(vertical + ': provisionSite (the build) has no marker and none of the sample text', () => {
      const site: any = provisionSite(tenant(industry))
      expect(hasMark(site)).toBe(false)
      const built = JSON.stringify(site)
      for (const t of sampleText(vertical, industry)) expect(built.includes(JSON.stringify(t).slice(1, -1))).toBe(false)
      expect(built).not.toContain('Sample review')
      expect(built).not.toContain(SAMPLE_BANNER)
    })
    test(vertical + ': the signup\'s template composer has none of it', () => {
      const composed = JSON.stringify(composeInstant({ businessName: 'Acme Co', businessType: industry, city: 'Eau Claire', state: 'WI', email: 'o@acme.example', services: ['Signature service'], goals: [] }))
      expect(composed).not.toContain('Sample review')
      expect(composed).not.toContain('(sample')
      for (const t of sampleText(vertical, industry)) expect(composed.includes(JSON.stringify(t).slice(1, -1))).toBe(false)
    })
  }

  test('only unified/preview.ts imports the samples (the build, the composers, signupSite and the unified server never do)', () => {
    const readers: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(ts|tsx|js|mjs|cjs|ejs)$/.test(e.name) && /previewSamples|SAMPLE_BANNER|withPreviewSamples/.test(fs.readFileSync(p, 'utf8'))) readers.push(path.relative(ROOT, p))
      }
    }
    for (const d of ['apps/api/src', 'apps/unified', 'packages']) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d))
    const allowed = ['apps/api/src/config/previewSamples.ts', 'apps/api/src/unified/preview.ts']
    // unified's own tests may name them; nothing else may.
    expect(readers.filter((r) => !allowed.includes(r) && !r.startsWith('apps/unified/tests/'))).toEqual([])
  })
})
