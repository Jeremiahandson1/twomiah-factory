/**
 * MEASURE contrast on the live fleet, in both themes, in a real browser.
 *
 * NOT A CI GUARD â€” it needs a browser on a debugging port and the ten live tenants, so it is not in
 * build-check.yml. It is the tool a round runs by hand, and it belongs in the repo because every
 * static contrast check in scripts/ has a ceiling this one does not:
 *
 *     msedge --headless=new --remote-debugging-port=9223 about:blank
 *     bun scripts/measure-contrast-live.ts light
 *     bun scripts/measure-contrast-live.ts dark
 *
 * WHAT IT CAUGHT THE FIRST TIME IT RAN (T47). The static guard said AIReceptionistPage.tsx was clean
 * and it was â€” the invisible text was in `components/ui/Table.tsx`'s EmptyState ("No auto-reply
 * rules", white on white) and `Tabs.tsx`'s inactive trigger (1.23:1). A per-file check cannot see a
 * component the page merely renders, and no static check can see a ground painted by a PARENT. This
 * found both in ninety seconds across three tenants.
 *
 * Keep the page list current: a page that is not in it cannot fail. T41's width run came back 79/79
 * clean while the Events pipeline was 35,110px wide, because `events` was not in its list.
 *
 * The static guard I added (#206) measures two page families from Tailwind's hex values. It cannot
 * see a background painted by a PARENT, which is why it names files rather than sweeping â€” so the
 * fleet-wide answer has to come from the browser, which resolves the cascade: the effective
 * background is the first opaque layer up the tree with every translucent layer composited onto it,
 * and the ink is whatever actually won.
 *
 * Same measurement engine as t41-contrast-measure.ts (that round came back 77/77 both themes). What
 * is new here:
 *
 *   Â· THIS ROUND'S SCREENS. AI Receptionist (5 templates), Support (8), the three Events screens,
 *     Dispatch and Invoices â€” none of which T41 looked at. Plus a wider sample per vertical, so a
 *     regression somewhere I did not touch is visible rather than assumed absent.
 *
 *   Â· MODALS ARE OPENED. The owner's finding was "the dark-mode pop-up TITLES are invisible", and a
 *     page-level sweep never sees a modal because it is not rendered until something is clicked. Each
 *     Events screen is measured again with its create pop-up open.
 *
 * WCAG AA: 4.5:1 for body text, 3:1 for large (>=24px, or >=18.66px bold).
 *
 * READ ONLY: one login POST per tenant, then navigation and clicks that open a form. Nothing is
 * submitted, so no row is created.
 *
 *   bun t47-contrast-measure.ts <light|dark>
 */
import { readFileSync } from 'node:fs'
for (const raw of readFileSync('C:/ALL TWOMIAH PRODUCTS/TwomiahFactory/apps/api/.env', 'utf8').split('\n')) {
  const m = raw.replace(/\r$/, '').match(/^([^#=]+)=(.*)$/)
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '')
}
const SB = process.env.SUPABASE_URL
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
const THEME = (process.argv[2] === 'dark' ? 'dark' : 'light')
const PORT = 9223

/**
 * Route paths read off each template's App.tsx, not guessed. roof and dispensary carry
 * `contact-support` rather than the shared SupportPage â€” which is why they were correctly outside
 * this round's eight-template Support fix.
 */
type Page = { path: string; open?: string }
/**
 * `dashboard` and `audit` added to every vertical, and the dispensary's security/scheduling screens.
 * (T51 follow-up)
 *
 * The width run came back 36 of 36 clean while the page the owner had reported was simply not in its
 * list. The same risk applies here, so the screens this round touched â€” the new Audit Log, the
 * dispensary's Security Events and Scheduling chips, every landing dashboard â€” are measured rather
 * than assumed.
 */
const PAGES: Record<string, Page[]> = {
  contractor: [
    { path: 'dashboard' }, { path: 'audit' },
    { path: 'ai-receptionist' }, { path: 'support' }, { path: 'invoices' },
    { path: 'warranties' }, { path: 'change-orders' }, { path: 'contacts' }, { path: 'quotes' },
  ],
  gym: [
    { path: 'dashboard' }, { path: 'audit' }, { path: 'commissions' }, { path: 'booking' },
    { path: 'ai-receptionist' }, { path: 'support' }, { path: 'invoices' },
    { path: 'contacts' }, { path: 'jobs' }, { path: 'quotes' }, { path: 'agreements' },
  ],
  hvac: [
    { path: 'dashboard' }, { path: 'audit' }, { path: 'warranties' },
    { path: 'ai-receptionist' }, { path: 'support' }, { path: 'invoices' }, { path: 'dispatch' },
    { path: 'agreements' }, { path: 'jobs' }, { path: 'contacts' },
  ],
  landscaping: [
    { path: 'dashboard' }, { path: 'audit' },
    { path: 'ai-receptionist' }, { path: 'support' }, { path: 'invoices' }, { path: 'dispatch' },
    { path: 'agreements' }, { path: 'jobs' },
  ],
  roofing: [
    // roofing's main screen is the /crm index (PipelineBoard); `dashboard` is a PORTAL route there,
    // so /crm/dashboard 404s — which is how this sweep ended up measuring a 404 page. (T51)
    { path: '' }, { path: 'canvassing' },
    { path: 'ai-receptionist' }, { path: 'contact-support' }, { path: 'invoices' }, { path: 'quotes' },
  ],
  // The pop-ups are the finding. Each Events screen is measured twice: as it loads, and with its
  // create form open, because a modal does not exist in the DOM until something is clicked.
  events: [
    { path: 'dashboard' }, { path: 'audit' },
    { path: 'events' }, { path: 'events', open: 'New Enquiry' },
    { path: 'spaces' }, { path: 'spaces', open: 'New Space' },
    { path: 'menus' }, { path: 'menus', open: 'New Package' },
    { path: 'support' }, { path: 'invoices' }, { path: 'contacts' },
  ],
  rv: [{ path: 'dashboard' }, { path: 'audit' }, { path: 'support' }, { path: 'invoices' }, { path: 'units' }],
  salon: [{ path: 'dashboard' }, { path: 'audit' }, { path: 'expenses' }, { path: 'support' }, { path: 'invoices' }, { path: 'contacts' }],
  veterinary: [{ path: 'dashboard' }, { path: 'audit' }, { path: 'support' }, { path: 'invoices' }, { path: 'patients' }],
  dispensary: [{ path: 'security' }, { path: 'scheduling' }, { path: 'audit' }, { path: 'dashboard' }, { path: 'compliance' }, { path: 'orders' }, { path: 'contact-support' }],
}

const rows: any[] = await (await fetch(
  `${SB}/rest/v1/tenants?is_test_tenant=eq.true&select=slug,industry,render_backend_url&order=industry`,
  { headers: { apikey: SK!, Authorization: `Bearer ${SK}` } },
)).json()

type Target = { label: string; url: string; origin: string; token: string; open?: string }
const targets: Target[] = []
for (const t of rows) {
  const pages = PAGES[t.industry]
  if (!pages) { console.log(`no page list for ${t.industry}`); continue }
  const BASE = String(t.render_backend_url || '').replace(/\/$/, '')
  let token = ''
  for (const [email, password] of [['twomiah14@gmail.com', 'TestPass123!'], ['qa.manager@example.com', 'CoworkQA123!']]) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).catch(() => null)
    if (!r) continue
    const j: any = await r.json().catch(() => ({}))
    if (j.accessToken || j.token) { token = j.accessToken || j.token; break }
  }
  if (!token) { console.log(`NO LOGIN ${t.industry} ${t.slug}`); continue }
  for (const p of pages) {
    targets.push({
      label: `${t.industry}/${p.path}${p.open ? ` [${p.open}]` : ''}`,
      url: `${BASE}/crm/${p.path}`, origin: BASE, token, open: p.open,
    })
  }
}
console.log(`${targets.length} target(s), ${THEME} mode\n`)

const cdp = async (ws: WebSocket, id: number, method: string, params: any = {}) =>
  new Promise<any>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = JSON.parse(String(e.data))
      if (m.id === id) { ws.removeEventListener('message', onMsg); m.error ? reject(new Error(m.error.message)) : resolve(m.result) }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { ws.removeEventListener('message', onMsg); reject(new Error(`timeout ${method}`)) }, 45000)
  })

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json() as any[]
const page = list.find((t) => t.type === 'page')
if (!page) { console.error('no page target â€” the browser needs --remote-debugging-port=9223'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
await cdp(ws, ++id, 'Page.enable')
await cdp(ws, ++id, 'Runtime.enable')

const EXPR = `(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(',').map(s => parseFloat(s));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05) };

  const bad = [];
  for (const el of document.querySelectorAll('*')) {
    // own text only â€” a wrapper inherits the colour but its child is what is read
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    own = own.trim();
    if (own.length < 2) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.15) continue;
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.1) continue;

    // the effective background: composite every translucent layer up to the first opaque one
    const layers = [];
    let a = el, opaque = { r: 255, g: 255, b: 255, a: 1 };
    while (a) {
      const bc = parse(getComputedStyle(a).backgroundColor);
      if (bc && bc.a > 0) { if (bc.a >= 0.999) { opaque = bc; break } layers.push(bc) }
      a = a.parentElement;
    }
    let bg = opaque;
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    const ink = over(fg, bg);

    const px = parseFloat(cs.fontSize) || 16;
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(ink, bg);
    if (got >= need) continue;
    bad.push({
      ratio: Math.round(got * 100) / 100, need,
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 95),
      txt: own.replace(/\\s+/g, ' ').slice(0, 40),
      color: cs.color, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
      px: Math.round(px),
    });
  }
  bad.sort((a, b) => a.ratio - b.ratio);
  // one row per distinct class+ratio â€” a list of 40 identical badges is one finding
  const seen = new Set(), out = [];
  for (const b of bad) { const k = b.cls + '|' + b.ratio; if (seen.has(k)) continue; seen.add(k); out.push(b) }
  const txt = (document.body ? document.body.innerText : '') || '';
  return JSON.stringify({ total: bad.length, distinct: out.length, worst: out.slice(0, 8), sample: txt.trim().slice(0, 45).replace(/\\s+/g, ' ') });
})()`

/** Open a create form by its button text, and say whether the pop-up actually appeared. */
const OPEN = (label: string) => `(() => {
  const want = ${JSON.stringify(label)}.toLowerCase();
  const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  const hit = els.find(x => (x.innerText || '').trim().toLowerCase().includes(want));
  if (!hit) return 'no-button';
  hit.click();
  return 'clicked';
})()`
const MODAL_PRESENT = `(() => {
  const d = document.querySelector('[role="dialog"], .fixed.inset-0');
  if (!d) return 'no-modal';
  const h = d.querySelector('h1,h2,h3');
  return 'modal:' + (h ? (h.innerText || '').trim().slice(0, 40) : 'no-heading');
})()`

let clean = 0, dirty = 0, skipped = 0
const failures: string[] = []
let lastOrigin = ''
for (const t of targets) {
  if (t.origin !== lastOrigin) {
    await cdp(ws, ++id, 'Page.navigate', { url: `${t.origin}/login` })
    await new Promise((r) => setTimeout(r, 2500))
    lastOrigin = t.origin
  }
  await cdp(ws, ++id, 'Runtime.evaluate', {
    expression: `localStorage.setItem('accessToken', ${JSON.stringify(t.token)}); localStorage.setItem('theme', ${JSON.stringify(THEME)}); 'ok'`,
  })
  await cdp(ws, ++id, 'Page.navigate', { url: t.url })
  await new Promise((r) => setTimeout(r, 6000))

  if (t.open) {
    let opened = ''
    try {
      const c = await cdp(ws, ++id, 'Runtime.evaluate', { expression: OPEN(t.open), returnByValue: true })
      opened = String(c.result.value)
      await new Promise((r) => setTimeout(r, 1500))
      const m = await cdp(ws, ++id, 'Runtime.evaluate', { expression: MODAL_PRESENT, returnByValue: true })
      opened += ' / ' + String(m.result.value)
    } catch (e: any) { opened = `err ${String(e.message).slice(0, 30)}` }
    if (/no-button|no-modal/.test(opened)) {
      skipped++
      console.log(`!!   ${t.label.padEnd(34)} could not open the pop-up (${opened})`)
      continue
    }
    console.log(`     ${t.label.padEnd(34)} ${opened}`)
  }

  let v: any
  try {
    const res = await cdp(ws, ++id, 'Runtime.evaluate', { expression: EXPR, returnByValue: true })
    v = JSON.parse(res.result.value)
  } catch (e: any) { console.log(`ERR  ${t.label.padEnd(34)} ${String(e.message).slice(0, 45)}`); skipped++; continue }
  if (/sign in to your account|forgot password/i.test(v.sample)) { console.log(`!!   ${t.label.padEnd(34)} bounced to login`); skipped++; continue }
  if (!v.total) { clean++; console.log(`ok   ${t.label.padEnd(34)} every label meets AA`); continue }
  dirty++
  failures.push(t.label)
  console.log(`FAIL ${t.label.padEnd(34)} ${v.total} label(s) below AA, ${v.distinct} distinct`)
  for (const b of v.worst) {
    console.log(`       ${String(b.ratio).padStart(5)}:1 (needs ${b.need})  <${b.tag} ${b.px}px> "${b.txt}"`)
    console.log(`              ${b.color} on ${b.bg}   class="${b.cls}"`)
  }
}
ws.close()
console.log(`\n${THEME}: ${clean} clean, ${dirty} with at least one failing label, ${skipped} not measured`)
if (failures.length) console.log(`failing: ${failures.join(', ')}`)
