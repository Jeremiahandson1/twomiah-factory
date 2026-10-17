// The CRM's own screens follow the company's colour from Settings — not only the colour chosen at signup.
//
// Every CRM's tailwind.config.js maps `orange`, `primary` and `brand` to the brand palette. It used to bake
// generatePalette('{{PRIMARY_COLOR}}') into the CSS at build time, so company.primaryColor changed later in
// Settings never reached the CRM's own buttons and menus until the tenant was regenerated — and the Settings
// field said the colour was for "the portal header, the payment form and your invoices" only.
//
// Now each shade is a CSS variable whose DEFAULT is the build-time palette, and the shell sets the same
// variables from company.primaryColor with the SAME generator (packages/tenant-ui/src/brandPalette.js).
// This proves:
//   1. the generator still gives what the templates' inline copies gave (frozen values) — no CRM changes colour
//   2. every template's config maps the families to the variables, with the build palette as their defaults,
//      loaded from the file the config itself names — and runtime output equals build output, colour by colour
//   3. the shared AppShell and every forked layout set them from company.primaryColor, and a save applies at once
//   4. an awkward owner colour (pale yellow, white, near-black, pure red, mid-grey…) cannot make white text on
//      a brand button, or brand ink on its own tint, unreadable
//
// Dependency-free: node:fs/path/url and the module under test.
//   bun run tests/shared/brand-palette-runtime.test.ts
import { readFileSync, existsSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const BP = await import(pathToFileURL(ROOT + 'packages/tenant-ui/src/brandPalette.js').href)
const { generatePalette, applyBrandPalette, paletteToCssVars, brandVarScale, normalizeHex, BRAND_SHADES } = BP

// ── colour maths, written here rather than borrowed from the module under test ──────────────────
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ')

/** A stand-in for document.documentElement: just the style API applyBrandPalette touches. */
const fakeRoot = () => {
  const props = new Map<string, string>()
  return { props, style: { setProperty: (n: string, v: string) => { props.set(n, v) }, removeProperty: (n: string) => { props.delete(n) } } }
}

// ═══ 1. the generator is the one the templates had ════════════════════════════════════════════════
//
// Frozen from the inline generatePalette every live template carried before this change (identical in all
// twelve; crm-homecare had an older, UNclamped copy — see below). If these move, every tenant's CRM changes
// colour on its next build.
const BEFORE: Record<string, Record<string, string>> = {"#f97316":{"50":"#fef3eb","100":"#fee1cd","200":"#fcc49c","300":"#fb9851","400":"#f97a1f","500":"#c25405","600":"#bd4f00","700":"#a84600","800":"#853700","900":"#662b00","950":"#3d1a00"},"#1d4ed8":{"50":"#edf1fd","100":"#d2dcf9","200":"#a5baf3","300":"#6286ea","400":"#3564e3","500":"#1d4ed8","600":"#133fb9","700":"#103498","800":"#0d2978","900":"#0a205c","950":"#061337"},"#16a34a":{"50":"#edfdf3","100":"#d2f9e0","200":"#a5f3c2","300":"#62ea94","400":"#35e375","500":"#12873d","600":"#0e8138","700":"#0d7d36","800":"#0d7834","900":"#0a5c28","950":"#063718"},"#009688":{"50":"#ebfffd","100":"#ccfffa","200":"#99fff5","300":"#51fbea","400":"#1ff9e3","500":"#008577","600":"#008073","700":"#007a6e","800":"#008577","900":"#00665c","950":"#003d37"},"#4f46e5":{"50":"#eeedfc","100":"#d4d2f9","200":"#aaa6f2","300":"#6a63e9","400":"#3f36e2","500":"#4f46e5","600":"#1d14b8","700":"#181197","800":"#130d77","900":"#0e0a5c","950":"#090637"},"#fff59d":{"50":"#fffdeb","100":"#fffacc","200":"#fff599","300":"#fbea51","400":"#f9e31f","500":"#857700","600":"#807300","700":"#807300","800":"#857700","900":"#665c00","950":"#3d3700"},"#ffffff":{"50":"#f5f5f5","100":"#e6e6e6","200":"#cccccc","300":"#a6a6a6","400":"#8c8c8c","500":"#757575","600":"#6b6161","700":"#585050","800":"#463f3f","900":"#363030","950":"#201d1d"},"#111111":{"50":"#f5f5f5","100":"#e6e6e6","200":"#cccccc","300":"#a6a6a6","400":"#8c8c8c","500":"#111111","600":"#6b6161","700":"#585050","800":"#463f3f","900":"#363030","950":"#201d1d"},"#ff0000":{"50":"#ffebeb","100":"#ffcccc","200":"#ff9999","300":"#fb5151","400":"#f91f1f","500":"#eb0000","600":"#cc0000","700":"#a80000","800":"#850000","900":"#660000","950":"#3d0000"},"#808080":{"50":"#f5f5f5","100":"#e6e6e6","200":"#cccccc","300":"#a6a6a6","400":"#8c8c8c","500":"#757575","600":"#6b6161","700":"#585050","800":"#463f3f","900":"#363030","950":"#201d1d"},"#ffff00":{"50":"#ffffeb","100":"#ffffcc","200":"#ffff99","300":"#fbfb51","400":"#f9f91f","500":"#7a7a00","600":"#757500","700":"#757500","800":"#858500","900":"#666600","950":"#3d3d00"},"#00ffff":{"50":"#ebffff","100":"#ccffff","200":"#99ffff","300":"#51fbfb","400":"#1ff9f9","500":"#008080","600":"#008080","700":"#007a7a","800":"#008585","900":"#006666","950":"#003d3d"},"#be185d":{"50":"#fdedf3","100":"#f9d2e2","200":"#f4a4c5","300":"#eb609a","400":"#e6337d","500":"#be185d","600":"#bb1158","700":"#9a0e49","800":"#790b39","900":"#5d092c","950":"#38051a"},"#0F766E":{"50":"#edfdfb","100":"#d2f9f6","200":"#a5f3ed","300":"#61eadf","400":"#34e5d6","500":"#0f766e","600":"#0c7d74","700":"#0c7970","800":"#0c7970","900":"#095d56","950":"#063834"}}
for (const [hex, want] of Object.entries(BEFORE)) {
  const got = generatePalette(hex)
  const off = Object.keys(want).filter((k) => got[k] !== want[k]).map((k) => `${k}: ${got[k]} (was ${want[k]})`)
  check(`generatePalette(${hex}) is what the templates' own copy gave, all 11 shades`, off.length === 0, off)
}
check('the shades are exactly 50–950', JSON.stringify(Object.keys(generatePalette('#1d4ed8'))) === JSON.stringify(BRAND_SHADES), Object.keys(generatePalette('#1d4ed8')))
check('an unreplaced build token falls back to the default orange', JSON.stringify(generatePalette('{{PRIMARY_COLOR}}')) === JSON.stringify(BEFORE['#f97316']))
check('…or to the template\'s own fallback when it names one', generatePalette('{{PRIMARY_COLOR}}', '#be185d')['500'] === '#be185d')
check('#rgb is read as #rrggbb (the company API accepts it)', JSON.stringify(generatePalette('#f00')) === JSON.stringify(generatePalette('#ff0000')))
check('normalizeHex refuses what is not a colour', normalizeHex('banana') === null && normalizeHex('') === null && normalizeHex(null) === null && normalizeHex(' #1D4ED8 ') === '#1d4ed8')

// ═══ 2. every template's config: variables, with the build palette as the defaults ═════════════════
//
// The config is LOADED — the token filled the way the Factory fills it, the generator imported from the
// path the config itself names — and what Tailwind would receive is compared with what the runtime sets.
const TEMPLATES = ['crm', 'crm-bar', 'crm-basic', 'crm-dispensary', 'crm-fieldservice', 'crm-homecare', 'crm-landscaping', 'crm-restaurant', 'crm-roof', 'crm-rv', 'crm-salon', 'crm-store', 'crm-vet']
const SAMPLE = ['#1d4ed8', '#fff59d', '#16a34a', '#ff0000', '#111111']
const scratch = mkdtempSync(join(tmpdir(), 'brand-palette-'))
const loadConfig = async (t: string, colour: string) => {
  const fe = ROOT + `templates/${t}/frontend`
  const src = read(`templates/${t}/frontend/tailwind.config.js`)
  // the Factory's own substitution: the literal token, replaced with the colour (generator.ts injectTokens)
  const filled = src.split('{{PRIMARY_COLOR}}').join(colour)
    .replace(/from\s*(['"])(\.[^'"]+)\1/g, (_m, q, rel) => `from ${q}${pathToFileURL(resolve(fe, rel)).href}${q}`)
  const file = join(scratch, `${t}-${colour.slice(1)}-${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(file, filled)
  return (await import(pathToFileURL(file).href)).default
}
const VAR_SCALE = brandVarScale()
try {
  for (const t of TEMPLATES) {
    const cfgSrc = read(`templates/${t}/frontend/tailwind.config.js`)
    const code = strip(cfgSrc)
    check(`${t}: the config builds with the ONE shared generator (src/shared/brandPalette.js), not its own copy`,
      /import\s*\{[^}]*\bgeneratePalette\b[^}]*\}\s*from\s*'\.\/src\/shared\/brandPalette\.js'/.test(code) && !/function\s+generatePalette/.test(code))
    check(`${t}: …from the colour chosen at signup`, /generatePalette\('\{\{PRIMARY_COLOR\}\}'/.test(code))
    // the template repo's shim re-exports the package; at generation the real file is vendored over it
    const shim = `templates/${t}/frontend/src/shared/brandPalette.js`
    check(`${t}: src/shared/brandPalette.js re-exports packages/tenant-ui's module`, existsSync(ROOT + shim)
      && /export \* from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/packages\/tenant-ui\/src\/brandPalette\.js'/.test(read(shim)))

    // EVERY template, the store included: packages/tenant-ui paints its brand controls orange-*, so a template that
    // leaves orange stock shows the shared screens in stock orange — the store's two-factor buttons were white on
    // #ea580c, 3.56:1, beside a blue shop.
    const families = ['orange', 'primary', 'brand']
    for (const colour of SAMPLE) {
      const cfg = await loadConfig(t, colour)
      const colors = cfg?.theme?.extend?.colors || {}
      const unmapped = families.filter((f) => JSON.stringify(colors[f]) !== JSON.stringify(VAR_SCALE))
      if (colour === SAMPLE[0]) {
        check(`${t}: ${families.join(', ')} map every shade 50–950 to rgb(var(--brand-N) / <alpha-value>)`, unmapped.length === 0, unmapped.map((f) => [f, colors[f]]))
        check(`${t}: …and each variable is spelled the way Tailwind's opacity modifier needs`, VAR_SCALE['500'] === 'rgb(var(--brand-500) / <alpha-value>)')
      }
      // the defaults: run the config's plugins the way Tailwind does and read what they put on :root
      const declared: Record<string, string> = {}
      for (const p of cfg.plugins || []) {
        const fn = typeof p === 'function' ? p : p?.handler
        if (typeof fn === 'function') fn({ addBase: (o: any) => Object.assign(declared, o?.[':root'] || {}) })
      }
      const build = paletteToCssVars(generatePalette(colour))
      const root = fakeRoot()
      applyBrandPalette(colour, root)
      const runtime = Object.fromEntries(root.props)
      const wantChannels = Object.fromEntries(BRAND_SHADES.map((s: string) => [`--brand-${s}`, channels(generatePalette(colour)[s])]))
      check(`${t} ${colour}: the build declares all 11 --brand-* defaults on :root from that colour`, JSON.stringify(declared) === JSON.stringify(wantChannels), declared)
      check(`${t} ${colour}: …and the runtime sets byte-for-byte the same values for the same colour`, JSON.stringify(runtime) === JSON.stringify(declared) && JSON.stringify(build) === JSON.stringify(declared), { runtime, declared })
    }
  }
} finally { rmSync(scratch, { recursive: true, force: true }) }

// The store's own screens keep no orange-* of their own now that orange IS the shop's colour: a status chip that
// changed hue with the brand would stop meaning "refunded". It is amber, which no template remaps.
{
  const { readdirSync, statSync } = await import('node:fs')
  const hits: string[] = []
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (n === 'shared' || n === 'node_modules') continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|css)$/.test(n) && /\b(bg|text|border|ring|from|to|via)-orange-\d/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(ROOT.length)) } }
  walk(ROOT + 'templates/crm-store/frontend/src')
  check('crm-store: no screen of its own uses orange-* for a meaning other than the brand', hits.length === 0, hits)
  check('crm-store: the "refunded" chip is amber, with its dark pair', /refunded: 'bg-amber-100 text-amber-800 dark:bg-amber-900\/30 dark:text-amber-200'/.test(read('templates/crm-store/frontend/src/lib/format.ts')))
}

// Nothing in the module is a Factory token: the generator injects tokens into every vendored file.
check('brandPalette.js carries no {{TOKEN}} the vendoring would rewrite', !/\{\{[A-Z_]+\}\}/.test(read('packages/tenant-ui/src/brandPalette.js')))

// ═══ 3. the runtime: applied on load, on save, and taken off when blank ═══════════════════════════
{
  const root = fakeRoot()
  applyBrandPalette('#fff59d', root)
  check('applyBrandPalette sets all 11 variables on the element', root.props.size === 11 && root.props.get('--brand-500') === channels(generatePalette('#fff59d')['500']))
  applyBrandPalette('', root)
  check('…blank ("use the default" in Settings) takes them all off, so the build defaults show again', root.props.size === 0)
  applyBrandPalette('#1d4ed8', root); applyBrandPalette('banana', root)
  check('…and so does a stored value that is not a colour, rather than painting nothing', root.props.size === 0)
  applyBrandPalette('#1d4ed8', root); applyBrandPalette('#16a34a', root)
  check('…a second colour replaces the first', root.props.get('--brand-500') === channels(generatePalette('#16a34a')['500']))
}

const hooks = strip(read('packages/tenant-ui/src/shell/hooks.ts'))
check('useBrandPalette runs applyBrandPalette from brandPalette.js — the same module the config imports',
  /import \{ applyBrandPalette \} from '\.\.\/brandPalette\.js'/.test(hooks)
  && /export function useBrandPalette\(primaryColor\?: string \| null\): void \{\s*useEffect\(\(\) => \{[\s\S]*?const applied = applyBrandPalette\(primaryColor\)[\s\S]*?\}, \[primaryColor\]\)/.test(hooks))
// The company's colour before the first render (10/17): a company not loaded yet (undefined) must not wipe the colour
// applied at startup, the applied colour is remembered, and startup applies the remembered one in every CRM.
const useBP = hooks.slice(hooks.indexOf('export function useBrandPalette'))
check('…a company not loaded yet leaves the startup colour alone', /if \(primaryColor === undefined\) return/.test(useBP) && useBP.indexOf('if (primaryColor === undefined) return') < useBP.indexOf('applyBrandPalette(primaryColor)'))
check('…the colour it applied is remembered, and a company with none forgets it', /if \(applied && primaryColor\) localStorage\.setItem\(BRAND_KEY, primaryColor\); else localStorage\.removeItem\(BRAND_KEY\)/.test(useBP))
check('applyStoredTheme applies the remembered colour at startup, through the same generator', /export function applyStoredTheme\(\): void \{[\s\S]*?applyStoredBrand\(\)\s*\}/.test(hooks) && /export function applyStoredBrand\(\): void \{[\s\S]*?localStorage\.getItem\(BRAND_KEY\)[\s\S]*?applyBrandPalette\(hex\)/.test(hooks))
for (const t of ['crm', 'crm-bar', 'crm-basic', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-roof', 'crm-rv', 'crm-salon', 'crm-vet', 'crm-store', 'crm-homecare', 'crm-dispensary']) {
  const main = strip(read(`templates/${t}/frontend/src/main.tsx`))
  check(`${t}: startup applies the remembered colour`, /^\s*applyStoredTheme\(\);?$/m.test(main) || /^\s*applyStoredBrand\(\);?$/m.test(main))
}
check('…and is exported for the forked layouts', /export \{[^}]*\buseBrandPalette\b[^}]*\} from '\.\/shell\/hooks'/.test(read('packages/tenant-ui/src/index.ts')))

// Every shell that draws the CRM: the shared one and each fork. A hook placed after an early return would
// throw, so it must sit with the other hooks — checked as "before the first `return`" of the component.
const SHELLS: Array<{ file: string; fn: RegExp }> = [
  { file: 'packages/tenant-ui/src/shell/AppShell.tsx', fn: /export function AppShell\(/ },
  { file: 'templates/crm-roof/frontend/src/components/layout/AppLayout.tsx', fn: /export default function AppLayout\(/ },
  { file: 'templates/crm-dispensary/frontend/src/components/layout/AppLayout.tsx', fn: /export default function AppLayout\(/ },
  { file: 'templates/crm-homecare/frontend/src/App.tsx', fn: /const MainApp = \(\) => \{/ },
]
for (const s of SHELLS) {
  const src = strip(read(s.file))
  const start = src.search(s.fn)
  const body = start < 0 ? '' : src.slice(start)
  const call = body.search(/useBrandPalette\(company\?\.primaryColor\)/)
  const firstReturn = body.search(/\n\s+(if \([^\n]*\) )?return\b/)
  check(`${s.file.split('/').slice(-4).join('/')}: sets the palette from company.primaryColor`, call > 0, s.file)
  check(`…before any early return (it is a hook)`, call > 0 && (firstReturn < 0 || call < firstReturn), { call, firstReturn })
}
// …and every template either mounts the shared shell or is one of the forks above
for (const t of TEMPLATES) {
  if (t === 'crm-store') continue // no brand colour exists to follow: store_settings has no colour column and no screen sets one
  const layout = `templates/${t}/frontend/src/components/layout/AppLayout.tsx`
  const src = existsSync(ROOT + layout) ? read(layout) : ''
  const covered = /<AppShell\b/.test(src) || SHELLS.some((s) => s.file.includes(`/${t}/`))
  check(`${t}: its shell follows company.primaryColor (shared AppShell, or a fork listed above)`, covered)
}

// A save shows at once: the shared Settings page puts the saved row into auth, which the shell reads.
const settings = strip(read('packages/tenant-ui/src/shell/SettingsPage.tsx'))
check('Settings › Company: the save hands the saved row to updateCompany (so the shell re-renders with the colour)',
  /const updated = await api\.put\('\/api\/company', payload\)\s*updateCompany\(updated\)/.test(settings))
const roofSettings = strip(read('templates/crm-roof/frontend/src/pages/settings/SettingsPage.tsx'))
check('roof Settings › Branding: a save puts the colour into auth at once', /updateCompany\(\{ primaryColor: colour \}\)/.test(roofSettings))
check('…and refuses what is not a 6-digit hex before saving it', /if \(!\/\^#\[0-9a-fA-F\]\{6\}\$\/\.test\(colour\)\) \{ toast\.error/.test(roofSettings))
const roofAuth = strip(read('templates/crm-roof/frontend/src/contexts/AuthContext.tsx'))
check('roof AuthContext offers updateCompany', /const updateCompany = \(updates: Partial<Company>\) =>/.test(roofAuth) && /hasFeature, updateCompany \}\}/.test(roofAuth))

// The help text no longer tells the owner the colour stops at the portal and invoices.
const page = read('packages/tenant-ui/src/shell/SettingsPage.tsx')
check('the Branding help text says the colour is on this CRM too', /Your colour across this CRM/.test(page))
check('…and no longer says "What your customers see:" as if that were all of it', !/>What your customers see: the portal header/.test(page))

// ═══ 4. contrast, for colours an owner might really pick ══════════════════════════════════════════
//
// The shades that carry WHITE text: 500 (primary button), 600 (its hover), 700 (bg-*-700 is only ever under
// white). The shade used as INK on its own tints: 700 on 50 and 100 (every status chip). Brand-coloured text
// on the page grounds: 900 on white, 200 on the dark card (#1e293b) — the pair check-contrast-measured.ts
// names as safe for every hue. Measured on the RUNTIME palette, i.e. what a Settings change produces.
const AWKWARD = ['#fff59d', '#ffffff', '#111111', '#ff0000', '#808080', '#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#f97316', '#000000', '#fefefe', '#2563eb', '#0000ff']
for (const colour of AWKWARD) {
  const root = fakeRoot()
  const p = applyBrandPalette(colour, root)
  const bad: string[] = []
  for (const s of ['500', '600', '700']) { const r = ratio('#ffffff', p[s]); if (r < 4.5) bad.push(`white on ${s} ${p[s]} ${r.toFixed(2)}:1`) }
  for (const s of ['50', '100']) { const r = ratio(p['700'], p[s]); if (r < 4.5) bad.push(`700 on ${s} ${r.toFixed(2)}:1`) }
  { const r = ratio(p['900'], '#ffffff'); if (r < 4.5) bad.push(`900 on white ${r.toFixed(2)}:1`) }
  { const r = ratio(p['200'], '#1e293b'); if (r < 4.5) bad.push(`200 on the dark card ${r.toFixed(2)}:1`) }
  check(`owner colour ${colour}: white on 500/600/700, 700 on its tints, and brand text in both themes all clear 4.5:1`, bad.length === 0, bad)
}
// The pairings the blue→brand conversion introduced (check-action-colour-is-brand.ts). Actions that were
// hard-coded blue now paint the brand, so each shade they use is measured here for every awkward colour:
//   · text links on the page                 600 / 700 on white
//   · ink on a selected tab / tinted button  700 and 900 on the 50 and 100 tints (800 → 900: 800 on white is
//                                            3.9:1 for a yellow brand, so light ink 800 became 900)
//   · white on the darkest hover             white on 900 (Sandata's and the desk's 700 buttons hover to 900:
//                                            white on 800 is 3.9:1 for a #ffff00 brand — 800 is not clamped)
//   · brand ink in dark mode                 200 on every dark ground the CRMs use, and on the brand's own
//                                            dark wash (950/40, 900/30 over slate-900) — 300 and 400 are NOT
//                                            used: on a pure-blue brand they fall to 2.7:1 and 1.8:1
//   · dark hover ink                         100 on the same grounds
//   · the roof portal (always bg-gray-900)   200 ink on gray-900 and on its gray-800 cards
const over = (fg: string, alpha: number, bg: string) => '#' + [1, 3, 5]
  .map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('')
const DARK_GROUNDS: Record<string, string> = { 'slate-900': '#0f172a', 'slate-800': '#1e293b', 'gray-900': '#111827', 'gray-800': '#1f2937' }
for (const colour of AWKWARD) {
  const p = generatePalette(colour)
  const bad: string[] = []
  const need = (what: string, fg: string, bg: string) => { const r = ratio(fg, bg); if (r < 4.5) bad.push(`${what} ${r.toFixed(2)}:1`) }
  need('600 link on white', p['600'], '#ffffff')
  need('700 link on white', p['700'], '#ffffff')
  for (const t of ['50', '100']) { need(`700 on ${t}`, p['700'], p[t]); need(`900 on ${t}`, p['900'], p[t]) }
  need('white on 900', '#ffffff', p['900'])
  for (const [name, g] of Object.entries(DARK_GROUNDS)) { need(`dark 200 on ${name}`, p['200'], g); need(`dark hover 100 on ${name}`, p['100'], g) }
  need('dark 200 on 950/40 over slate-900', p['200'], over(p['950'], 0.4, DARK_GROUNDS['slate-900']))
  need('dark 200 on 900/30 over slate-900', p['200'], over(p['900'], 0.3, DARK_GROUNDS['slate-900']))
  check(`owner colour ${colour}: the converted actions' shades — links, tinted selections, dark-mode ink — all clear 4.5:1`, bad.length === 0, bad)
}

// …and the clamp only darkens what needs it: a colour that already clears is the button, unchanged.
check('a brand that already clears under white is used exactly as picked', generatePalette('#1d4ed8')['500'] === '#1d4ed8' && generatePalette('#111111')['500'] === '#111111')
check('a pale one is darkened, keeping its hue', generatePalette('#fff59d')['500'] !== '#fff59d' && ratio('#ffffff', generatePalette('#fff59d')['500']) >= 4.5)

// The portal's own clamp (brand.ts) lands on the same shade as the button for every hue — brand.ts says so.
{
  const { brandSurfaceUnderWhite } = await import(pathToFileURL(ROOT + 'packages/tenant-ui/src/brand.ts').href)
  const off: string[] = []
  for (let h = 0; h < 360; h += 3) for (const [s, l] of [[100, 50], [60, 70], [30, 85]]) {
    const hex = BP.hslToHex(h, s, l)
    if (brandSurfaceUnderWhite(hex) !== generatePalette(hex)['500']) off.push(`${hex}: tile ${brandSurfaceUnderWhite(hex)} vs button ${generatePalette(hex)['500']}`)
  }
  check('brandSurfaceUnderWhite (the portal tile) and the palette\'s 500 (the button) agree across the hue circle', off.length === 0, off.slice(0, 5))
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
