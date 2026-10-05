// CI guard: a composed premium site states only the facts its owner supplied.
//
// Higgs Heritage Builders (2026-10-03) went live with a 16-job portfolio of stock photos captioned
// as their projects, kitchen prices, a $15k project minimum, invented staff roles, permit and hours
// claims, and stock faces captioned as the owners. None of it came from the owners. The composer
// prompt TOLD the model to do most of it ("realistic 2026 ranges", "caption each project", "plausible
// strain names", "composite caregiver profiles", default business hours).
//
// The fix has three layers, and this guard holds each one:
//   1. BEHAVIOUR — services/composerFacts.ts strips every number, price, year, person, credential,
//      quote and photo caption the intake does not contain, drops sections left empty, and holds
//      back pages with nothing real on them. Exercised directly on a Higgs-shaped fixture: a rule
//      checked by grepping for its keyword is a rule nobody tested.
//   2. WIRING — every composer entry point runs that check before it returns, and every caller hands
//      it the owner's facts. One door left open is the whole bug again.
//   3. THE PROMPT and THE PARTIALS — the instructions to invent are gone, and the section partials
//      no longer print their own invented defaults (a 25-guest minimum, "parts included") when a
//      field is missing.
//
// No model call, no network, no install: composerFacts.ts is pure and sectionComposer.ts loads the
// Anthropic SDK lazily.
//
//   bun scripts/check-composer-facts.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { enforceIntakeFacts, extractNumbers, parseIntakeFacts } from '../apps/api/src/services/composerFacts.ts'
import { SECTION_SCHEMA, sanitizeSections, type ComposerInput, type Section } from '../apps/api/src/services/sectionComposer.ts'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
let passed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }
const check = (ok: boolean, m: string) => { if (ok) passed++; else fail(m) }
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')

const requiredOf = (type: string, variant: string) =>
  ((SECTION_SCHEMA as any)[type]?.[variant]?.required || []) as readonly string[]
const ALL_TYPES = new Set(Object.keys(SECTION_SCHEMA))
const NOW = new Date('2026-10-04T12:00:00Z')
const run = (pages: Record<string, Section[]>, input: ComposerInput) =>
  enforceIntakeFacts(pages, input, { requiredOf, allowedTypes: ALL_TYPES, now: NOW })
const sec = (type: string, variant: string, data: Record<string, any>): Section => ({ type, variant, data })

// ─── 1. Behaviour ───────────────────────────────────────────────────────────

const STOCK = 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=1400&q=80'
const STOCK_FACE = 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=800'
const OWNER_PHOTO = 'https://r2.example/intake/higgs/job1.jpg'
const LOGO = 'https://r2.example/intake/higgs/logo.png'

const higgs: ComposerInput = {
  businessName: 'Higgs Heritage Builders',
  businessType: 'general contractor',
  city: 'Fort Worth', state: 'TX',
  description: 'Two brothers who grew up in Texas. Interior and exterior remodeling, everything except full new builds. Licensed, insured and bonded. Free estimates.',
  ownerName: 'Wesley Higgs',
  phone: '817-888-5135',
  services: ['Kitchen remodels', 'Bathroom remodels', 'Siding', 'Decks'],
}

const invented = (): Record<string, Section[]> => ({
  home: [
    sec('hero', 'full-bleed', {
      image: STOCK, title: 'Two Brothers. One Standard.',
      subtitle: 'Kitchens from $35k. Two brothers, one standard. Call 817-888-5135.',
      stats: [{ value: '16', label: 'Projects this year' }, { value: '4.9', label: 'Google rating' }],
      secondaryCta: { label: 'See our projects', href: 'projects' },
    }),
    sec('services', 'cards-grid', { items: [{ title: 'Kitchen remodels', description: 'Most kitchens take 6-8 weeks. We handle cabinets, counters and tile.', image: STOCK, href: 'contact' }] }),
    sec('gallery', 'grid', { photos: [{ url: STOCK, alt: 'Kitchen', caption: 'Southlake kitchen, 2024 — 7 weeks' }] }),
    sec('testimonials', 'quotes', { items: [{ quote: 'They finished our kitchen two weeks early!', author: 'Dana R.', role: 'Southlake', photo: STOCK_FACE }] }),
    sec('stats', 'bar', { items: [{ value: '26', label: 'Years' }, { value: '120+', label: 'Kitchens' }] }),
    sec('faq', 'accordion', { items: [
      { question: 'What is your minimum?', answer: 'Our minimum project is $15,000.' },
      { question: 'Are estimates free?', answer: 'Yes — estimates are free.' },
    ] }),
    sec('financing', 'calculator', { heading: 'Financing', fromMonthly: 99, apr: 7.99 }),
    sec('quote', 'instant-address', { heading: 'Ballpark', pricePerSqFt: 5.5 }),
    sec('cta', 'banner', { heading: 'Ready when you are', primaryCta: { label: 'Get an estimate', href: 'contact' } }),
  ],
  about: [
    sec('about', 'story', {
      title: 'Our story', portrait: STOCK_FACE,
      paragraphs: ['Since 2009 we have built 120 kitchens across Tarrant County.', 'Two brothers, two paths, one business.'],
      signature: 'Wesley Higgs, Owner',
    }),
    sec('team', 'grid', { members: [
      { name: 'Marcus Lee', role: 'Lead carpenter', portrait: STOCK_FACE },
      { name: 'Wesley Higgs', role: 'Co-owner', portrait: STOCK_FACE },
      { name: 'Wesley H.', role: 'Master electrician' },
    ] }),
  ],
  projects: [
    sec('hero', 'centered-stats', { eyebrow: 'Projects', title: 'Recent work', stats: [{ value: '16', label: 'jobs' }] }),
    sec('gallery', 'grid', { photos: [{ url: STOCK, caption: 'Keller bath, 2023' }, { url: STOCK, caption: 'Deck, 2025' }] }),
    sec('cta', 'banner', { heading: 'Like what you see?' }),
  ],
  contact: [
    sec('contact', 'form-info', { phone: '817-888-5135', hours: ['Monday – Friday: 8am – 5pm'], address: '1200 Main St, Fort Worth, TX', responsePromise: 'We reply within one business day.' }),
  ],
})

{
  const r = run(invented(), higgs)
  const out = JSON.stringify(r.pages)
  for (const claim of ['35k', '35000', '15,000', '4.9', '120', '2009', '6-8 weeks', 'two weeks early', 'Southlake', 'Keller', '8am', '1200 Main', 'one business day', 'Marcus', 'Lead carpenter', '7.99', 'pricePerSqFt']) {
    check(!out.includes(claim), `unsupplied fact survived: "${claim}"`)
  }
  check(out.includes('Two brothers, one standard.'), 'a sentence whose number the intake states ("Two brothers") must survive')
  check(out.includes('817-888-5135'), 'the owner\'s phone number is not a claim and must survive')
  check(out.includes('Two Brothers. One Standard.'), 'hero title from intake facts must survive')
  const home = r.pages.home.map(s => s.type)
  for (const t of ['gallery', 'testimonials', 'stats', 'financing', 'quote']) check(!home.includes(t), `home kept a ${t} section with no owner-supplied facts behind it`)
  const hero = r.pages.home.find(s => s.type === 'hero')!
  check(!hero.data.stats || hero.data.stats.length === 0, 'hero stats with unsupplied numbers must be removed')
  check(!hero.data.secondaryCta, 'a button linking to a held page must be removed (it would 404 live)')
  const faq = r.pages.home.find(s => s.type === 'faq')
  check(!!faq && faq.data.items.length === 1 && /free/.test(faq.data.items[0].answer), 'FAQ keeps the answer the intake supports and drops the invented minimum')
  const story = r.pages.about.find(s => s.type === 'about')!
  check(story.data.portrait === '', 'a stock portrait beside the founder story must be removed')
  check(story.data.signature === 'Wesley Higgs', 'the signature is the intake owner name, without an invented role')
  check(story.data.paragraphs.length === 1, 'the about paragraph with an invented year and count must be dropped')
  const team = r.pages.about.find(s => s.type === 'team')
  check(!!team && team.data.members.length === 2 && team.data.members[0].name === 'Wesley Higgs' && !team.data.members[0].portrait,
    'team keeps only people the intake names, and never under a stock face')
  check(team?.data.members[0].role === 'Co-owner', 'the named owner may be called owner/co-owner')
  check(!!team && !('role' in team.data.members[1]), 'an invented role ("Master electrician") is removed even from a real name')
  check(r.heldPages.includes('projects'), 'a Projects page with no photos of the owner\'s work must be held back')
  check(!r.heldPages.includes('home') && !r.heldPages.includes('contact'), 'home and contact are never held')
  const contact = r.pages.contact[0]
  check(!contact.data.hours && !contact.data.address, 'invented hours and address must be removed from the contact section')
  const gapIds = r.contentGaps.map(g => g.id)
  for (const id of ['photos', 'ownerPhoto', 'testimonials', 'yearFounded', 'hours']) check(gapIds.includes(id as any), `content gap "${id}" must be reported`)
  check(!gapIds.includes('description'), 'no "describe your business" gap when the intake has a description')
  check(!gapIds.includes('credentials'), 'no credentials gap when the description already says "Licensed, insured and bonded"')
  const photosGap = r.contentGaps.find(g => g.id === 'photos')
  check(!!photosGap && /Projects/.test(photosGap.unlocks), 'the photos gap must say it unlocks the held Projects page')
  check(r.removedClaims.length > 0, 'removed claims are reported for staff review')
}

// With the facts supplied, the same sections survive — the check removes what is unsupported, not
// everything with a number in it.
{
  const input: ComposerInput = {
    ...higgs,
    customerPhotos: [{ url: LOGO, tag: 'misc', alt: 'Higgs Heritage Builders logo' }, { url: OWNER_PHOTO }],
    facts: {
      yearFounded: 2014,
      hours: 'Mon–Sat 7am–6pm',
      testimonials: [{ quote: 'They finished our kitchen two weeks early and cleaned up every day.', author: 'Dana R.' }],
      credentials: ['Licensed', 'Insured', 'Bonded'],
    },
  }
  const pages: Record<string, Section[]> = {
    home: [
      sec('hero', 'full-bleed', { image: STOCK, title: 'Since 2014, two brothers', subtitle: '12 years of Fort Worth remodels.' }),
      sec('testimonials', 'quotes', { items: [
        { quote: 'They finished our kitchen two weeks early and cleaned up every day.', author: 'D. R.', role: 'Southlake' },
        { quote: 'Best contractor in Texas, five stars.', author: 'Sam' },
      ] }),
      sec('gallery', 'grid', { photos: [{ url: OWNER_PHOTO, caption: 'Southlake kitchen, 2024' }, { url: LOGO, caption: 'Logo' }, { url: STOCK }] }),
      sec('trust', 'badges', { items: [{ name: 'Licensed & Insured' }, { name: 'BBB A+ Rated' }] }),
    ],
    contact: [sec('contact', 'form-info', { hours: ['Monday – Friday: 8am – 5pm'] })],
  }
  const r = run(pages, input)
  const hero = r.pages.home.find(s => s.type === 'hero')!
  check(hero.data.title === 'Since 2014, two brothers', 'a year the intake supplies survives')
  check(hero.data.subtitle === '12 years of Fort Worth remodels.', 'years-in-business derived from the founding year survives')
  const t = r.pages.home.find(s => s.type === 'testimonials')
  check(!!t && t.data.items.length === 1 && t.data.items[0].author === 'Dana R.' && !('role' in t.data.items[0]),
    'the real review survives with the intake\'s attribution; the invented one and the invented role go')
  const g = r.pages.home.find(s => s.type === 'gallery')
  check(!!g && g.data.photos.length === 1 && g.data.photos[0].url === OWNER_PHOTO && !g.data.photos[0].caption,
    'gallery keeps only the owner\'s work photos (not the logo, not stock) and no captions')
  const trust = r.pages.home.find(s => s.type === 'trust')
  check(!!trust && trust.data.items.length === 1 && trust.data.items[0].name === 'Licensed & Insured', 'only credentials the intake states survive')
  check(JSON.stringify(r.pages.contact[0].data.hours) === JSON.stringify(['Mon–Sat 7am–6pm']), 'contact hours are the owner\'s hours')
  const gapIds = r.contentGaps.map(x => x.id)
  check(!gapIds.includes('photos') && !gapIds.includes('testimonials') && !gapIds.includes('yearFounded') && !gapIds.includes('hours'),
    'supplied facts are not reported as gaps')
}

// A page the model left empty (a pricing page with no prices) is held, not published blank.
{
  const r = run({ home: [sec('hero', 'full-bleed', { image: STOCK, title: 'Hi' })], pricing: [] }, higgs)
  check(r.heldPages.includes('pricing'), 'an empty page must be held back')
}

// The model sometimes writes sections FLAT ({ type, variant, title, … }) instead of wrapping the
// fields in `data`. Live compose 2026-10-04 (Ridgeline test intake): sanitize read only s.data, every
// section reached the facts check empty, and the site came back with an empty home page.
{
  const [flat, wrapped] = sanitizeSections([
    { type: 'hero', variant: 'full-bleed', image: STOCK, title: 'Kitchens and baths in Eau Claire' },
    { type: 'cta', variant: 'banner', data: { heading: 'Talk to us' } },
  ])
  check(flat?.data.title === 'Kitchens and baths in Eau Claire' && flat?.data.image === STOCK && !('type' in flat.data),
    'sanitizeSections must read a flat section\'s fields as its data')
  check(wrapped?.data.heading === 'Talk to us', 'sanitizeSections still reads the wrapped shape')
  const r = run({ home: sanitizeSections([{ type: 'hero', variant: 'full-bleed', image: STOCK, title: 'Kitchens and baths' }]) }, higgs)
  check(r.pages.home.length === 1 && r.pages.home[0].data.title === 'Kitchens and baths', 'a flat hero survives the facts check')
}

// Numbers: what counts as a claim.
{
  const eq = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b)
  check(eq(extractNumbers('$1,850 and 15k'), ['1850', '15000']), 'extractNumbers: money and k-suffix')
  check(eq(extractNumbers('twenty-six years'), ['26']), 'extractNumbers: spelled compound')
  check(eq(extractNumbers('open 8am'), ['8']), 'extractNumbers: times are numbers')
  check(eq(extractNumbers('Call (817) 888-5135 or a@b.co'), []), 'extractNumbers: contact details are not claims')
  check(eq(extractNumbers('no one else, the one who shows up'), []), 'extractNumbers: "one" is a word, not a count')
}

// The intake's review textarea.
{
  const f = parseIntakeFacts({
    yearFounded: '2014', credentials: ['Licensed', ' Insured '], freeEstimates: true, hours: 'Mon–Fri 8–5',
    testimonials: '"Great work on our deck."\n— Pat K.\n\nFast and tidy.',
  }, NOW)
  check(!!f && f.yearFounded === 2014 && f.freeEstimates === true && f.credentials?.join('|') === 'Licensed|Insured', 'parseIntakeFacts: scalar fields')
  check(!!f && f.testimonials?.length === 2 && f.testimonials[0].quote === 'Great work on our deck.' && f.testimonials[0].author === 'Pat K.' && !f.testimonials[1].author,
    'parseIntakeFacts: reviews split on blank lines, dash line is the attribution')
  check(parseIntakeFacts({ yearFounded: '3020' }, NOW) === undefined, 'parseIntakeFacts: a future year is not a founding year')
}

// ─── 2. Wiring ──────────────────────────────────────────────────────────────

const composer = read('apps/api/src/services/sectionComposer.ts')
const body = (name: string) => {
  const start = composer.indexOf('export async function ' + name + '(')
  if (start < 0) return ''
  const next = composer.indexOf('\nexport ', start + 10)
  return composer.slice(start, next < 0 ? undefined : next)
}
for (const fn of ['composeSite', 'composeHomepageSections']) {
  const b = body(fn)
  check(b.length > 0, `${fn} not found in sectionComposer.ts`)
  check(/enforceIntakeFacts\(/.test(b), `${fn} must run enforceIntakeFacts before it returns`)
  check(/enforced\.pages/.test(b), `${fn} must return the ENFORCED pages, not the raw composition`)
}
check(/heldPages:\s*enforced\.heldPages/.test(body('composeSite')) && /contentGaps:\s*enforced\.contentGaps/.test(body('composeSite')),
  'composeSite must return heldPages and contentGaps')
check(/\$\{FACTS_POLICY\}/.test(composer.slice(composer.indexOf('function buildPrompt('), composer.indexOf('export async function composeHomepageSections'))),
  'the single-page prompt must include FACTS_POLICY')
check(/\$\{FACTS_POLICY\}/.test(composer.slice(composer.indexOf('function buildSitePrompt('), composer.indexOf('export async function composeSite'))),
  'the multi-page prompt must include FACTS_POLICY')

// Every production caller of composeSite hands it the owner's facts and notes.
const callers = ['apps/api/src/routes/factory/intake.ts']
for (const file of callers) {
  const src = read(file)
  const calls = src.split('composeSite({').slice(1).map(s => s.slice(0, s.indexOf('})')))
  check(calls.length >= 3, `${file}: expected the staff, auto-compose and recompose calls to composeSite`)
  calls.forEach((c, i) => {
    check(/\bfacts:/.test(c), `${file}: composeSite call #${i + 1} does not pass facts`)
    check(/\bnotes:/.test(c), `${file}: composeSite call #${i + 1} does not pass the free-form notes`)
  })
}
{
  const src = read('apps/api/src/routes/factory/intake.ts')
  check(/isPublished:\s*!heldPages\.has\(slug\)/.test(src), 'site-bootstrap must seed held pages unpublished')
  check(/buildPremiumNav\(pages\.filter\(p => p\.isPublished\)/.test(src), 'site-bootstrap must keep held pages out of the nav')
  check(/contentGaps:\s*Array\.isArray\(composed\.contentGaps\)/.test(src), 'site-bootstrap must seed contentGaps')
  check(/parseIntakeFacts\(/.test(src), '/public/intake must parse the owner\'s fact fields')
}

// ─── 3. The prompt and the partials ─────────────────────────────────────────

// The instructions that produced the inventions. Each is the property, phrased the way it was
// written; a reworded reintroduction is what part 1 exists to catch.
const INVENT = [
  /pick from (the|common)[- ]industry ranges/i,
  /realistic 2026 (regional |dinner |caf[eé] |pricing|ranges|venue)/i,
  /generate\s+plausible strain names/i,
  /composite\/anonymized names/i,
  /use industry-standard/i,
  /Caption each project with/i,
  /Use realistic Wisconsin\/Midwest cities/i,
  /pricePerSqFt 0\.04-0\.10/i,
  /Monday – Friday: 8am – 5pm/,
  /within one business day\."\n/,
  /generate plausible questions/i,
  // The empty-page retry once demanded "at least 2 sections" — pressure to invent content for a
  // page whose purpose is facts the intake lacks.
  /MUST have at least 2 sections/,
]
check(!/throw new Error\('Site composer returned empty sections for/.test(composer),
  'composeSite must not fail the whole compose over an empty non-home page — enforceIntakeFacts holds it')
for (const re of INVENT) check(!re.test(composer), `sectionComposer.ts still instructs the model to invent: ${re}`)

const premium = readdirSync(ROOT + 'templates').filter(d => d.startsWith('website-premium-'))
check(premium.length >= 10, 'expected the premium templates')
for (const t of premium) {
  const base = 'templates/' + t + '/views/sections/'
  const catering = base + 'catering/inquiry-form.ejs'
  if (existsSync(ROOT + catering)) {
    const s = read(catering)
    // The DECLARED values (what the sidebar prints) — `min="<%= minHeadcount || 1 %>"` is form validation, not a claim.
    check(!/const minHeadcount = [^\n]*\|\|\s*\d/.test(s) && !/const leadTimeWeeks = [^\n]*\|\|\s*\d/.test(s), `${catering}: invents a minimum headcount or lead time when none is given`)
    check(!/responsePromise\s*\|\|\s*'[^']/.test(s), `${catering}: invents a reply promise when none is given`)
  }
  const pricing = base + 'pricing/flat-rate-menu.ejs'
  if (existsSync(ROOT + pricing)) check(!/disclaimer\s*\|\|\s*'[^']/.test(read(pricing)), `${pricing}: invents pricing terms when none are given`)
  const story = base + 'about/story.ejs'
  if (existsSync(ROOT + story)) check(/<% if \(portrait\) \{ %><div class="story__portrait"/.test(read(story)), `${story}: must not draw an empty portrait box`)
  const team = base + 'team/grid.ejs'
  if (existsSync(ROOT + team)) check(/<% if \(m\.portrait\) \{ %><div class="team__portrait"/.test(read(team)), `${team}: must not draw an empty portrait box`)
  check(/contentGaps: jsonb\('content_gaps'\)/.test(read('templates/' + t + '/db/schema.ts')), `templates/${t}: settings.content_gaps column missing`)
  check(/'contentGaps',/.test(read('templates/' + t + '/routes/admin.ts')), `templates/${t}: admin cannot save the checklist`)
  check(/contentGaps: payload\.settings\.contentGaps/.test(read('templates/' + t + '/scripts/initDb.ts')), `templates/${t}: initDb does not seed the checklist`)
  check(/<FinishYourSiteCard \/>/.test(read('templates/' + t + '/admin/src/pages/PagesListPage.tsx')), `templates/${t}: the checklist card is not mounted`)
}

if (failed) {
  console.error(`\n${failed} failed, ${passed} passed`)
  process.exit(1)
}
console.log(`composer facts: ${passed} checks passed`)
