/**
 * MEASURE page width on the live fleet, in a real browser.
 *
 * NOT A CI GUARD â€” it needs a browser on a debugging port and the ten live tenants:
 *
 *     msedge --headless=new --remote-debugging-port=9223 about:blank
 *     bun scripts/measure-width-live.ts 390
 *     bun scripts/measure-width-live.ts 1280
 *
 * Its companion is scripts/measure-contrast-live.ts. Keep the page list current â€” the whole reason
 * this file exists is a page that was missing from the previous one.
 *
 * WHY THIS IS NOT JUST t41-width-measure.ts RE-RUN. That script's page list for `events` is
 * `spaces, bookings, menus, contacts`. **`events` itself is not in it.** So T41's width run came back
 * 79/79 clean while the Events pipeline â€” the default landing view of that vertical's main screen â€”
 * was 35,110 pixels wide. A sweep's WALK matters as much as its rule, and a page that is not in the
 * list cannot fail.
 *
 * `view` is component state defaulting to 'pipeline' (EventsPage.tsx:81), so navigating to
 * /crm/events lands on exactly the view that was broken. The List view is reached by clicking the
 * toggle, so it gets its own target.
 *
 * Measured the way the earlier round learned to: `documentElement.clientWidth`, never
 * `window.innerWidth` â€” under mobile emulation Chrome widens the layout viewport when content
 * overflows, so innerWidth reports the widened figure and every broken page reads as "fits".
 * An element inside a scroll/clip container is not a cause, so those are excluded.
 *
 * READ ONLY: a login POST per tenant, then navigation and one view-toggle click. Nothing submitted.
 *
 *   bun t47-width-measure.ts 390
 *   bun t47-width-measure.ts 1280
 */
import { readFileSync } from 'node:fs'
for (const raw of readFileSync('C:/ALL TWOMIAH PRODUCTS/TwomiahFactory/apps/api/.env', 'utf8').split('\n')) {
  const m = raw.replace(/\r$/, '').match(/^([^#=]+)=(.*)$/)
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '')
}
const SB = process.env.SUPABASE_URL
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
const WIDTH = Number(process.argv[2] || 390)
const HEIGHT = 844
const PORT = 9223

type Page = { path: string; click?: string }
const PAGES: Record<string, Page[]> = {
  // The whole point of this run. `events` defaults to the pipeline; the list view needs the toggle.
  events: [
    { path: 'dashboard' },
    { path: 'events' }, { path: 'events', click: 'List' },
    { path: 'spaces' }, { path: 'menus' }, { path: 'contacts' },
    { path: 'support' }, { path: 'invoices' },
  ],
  /**
   * THE PAGES THE OWNER NAMED, ADDED BECAUSE THEY WERE NOT HERE. (T51 follow-up)
   *
   * The owner reported "the 390px dashboard is 12px too wide" on showcase and "Canvassing is clipped
   * at 390" on roofing. This run came back 36 of 36 clean â€” because neither `gym/dashboard` nor
   * `roofing/canvassing` was in the list. That is the fault documented at the top of this very file,
   * repeated: a page that is not in the list cannot fail.
   *
   * `dashboard` is added for EVERY vertical, not just the one that was reported. It is the landing
   * screen of every tenant and it was missing from all ten.
   */
  contractor: [{ path: 'dashboard' }, { path: 'ai-receptionist' }, { path: 'support' }, { path: 'invoices' }, { path: 'warranties' }, { path: 'audit' }],
  gym: [{ path: 'dashboard' }, { path: 'ai-receptionist' }, { path: 'support' }, { path: 'invoices' }, { path: 'jobs' }, { path: 'quotes' }, { path: 'commissions' }, { path: 'booking' }, { path: 'audit' }],
  hvac: [{ path: 'dashboard' }, { path: 'ai-receptionist' }, { path: 'support' }, { path: 'invoices' }, { path: 'dispatch' }, { path: 'equipment' }, { path: 'warranties' }, { path: 'audit' }],
  landscaping: [{ path: 'dashboard' }, { path: 'ai-receptionist' }, { path: 'support' }, { path: 'invoices' }, { path: 'dispatch' }, { path: 'audit' }],
  roofing: [{ path: '' }, { path: 'ai-receptionist' }, { path: 'contact-support' }, { path: 'invoices' }, { path: 'canvassing' }],
  rv: [{ path: 'dashboard' }, { path: 'support' }, { path: 'invoices' }, { path: 'audit' }],
  salon: [{ path: 'dashboard' }, { path: 'support' }, { path: 'invoices' }, { path: 'expenses' }, { path: 'audit' }],
  veterinary: [{ path: 'dashboard' }, { path: 'support' }, { path: 'invoices' }, { path: 'audit' }],
  dispensary: [{ path: 'contact-support' }, { path: 'dashboard' }, { path: 'compliance' }, { path: 'security' }, { path: 'scheduling' }, { path: 'audit' }],
}

const rows: any[] = await (await fetch(
  `${SB}/rest/v1/tenants?is_test_tenant=eq.true&select=slug,industry,render_backend_url&order=industry`,
  { headers: { apikey: SK!, Authorization: `Bearer ${SK}` } },
)).json()

type Target = { label: string; url: string; origin: string; token: string; click?: string }
const targets: Target[] = []
for (const t of rows) {
  const pages = PAGES[t.industry]
  if (!pages) continue
  const BASE = String(t.render_backend_url || '').replace(/\/$/, '')
  if (!BASE) { console.log(`no backend url for ${t.slug}`); continue }
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
      label: `${t.industry}/${p.path}${p.click ? ` [${p.click}]` : ''}`,
      url: `${BASE}/crm/${p.path}`, origin: BASE, token, click: p.click,
    })
  }
}
console.log(`${targets.length} target(s) at ${WIDTH}px\n`)

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
  const de = document.documentElement, over = [];
  const VW = de.clientWidth;
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > VW + 1) {
      const pr = el.parentElement ? el.parentElement.getBoundingClientRect() : null;
      let anc = el.parentElement, clipped = false;
      while (anc) { if (getComputedStyle(anc).overflowX !== 'visible') { clipped = true; break } anc = anc.parentElement }
      if (clipped) continue;
      over.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 95),
        txt: String(el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
        w: Math.round(r.width), right: Math.round(r.right),
        pw: pr ? Math.round(pr.width) : null,
        wider: pr ? r.width > pr.width + 1 : false,
      });
    }
  }
  over.sort((a, b) => b.right - a.right);

  /**
   * CLIPPED is not the same fault as OVERFLOWING, and this script was blind to it. (T51 follow-up)
   *
   * The loop above deliberately SKIPS anything inside a clipping ancestor, because such an element
   * cannot push the document wider — correct for "is the page too wide". But the owner reported
   * "Canvassing is clipped at 390", which is the other failure: content cut off INSIDE a box, with
   * no way to reach it. This run said roofing/canvassing fits, and it does; nobody had looked for
   * content being lost.
   *
   * A box is losing content when its scrollWidth exceeds its clientWidth AND it cannot be scrolled
   * — overflow hidden/clip. Where it is auto/scroll the content is reachable, which is a legitimate
   * pattern this fleet uses for wide tables, so those are not reported.
   */
  const cut = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const ox = cs.overflowX;
    if (ox !== 'hidden' && ox !== 'clip') continue;
    const lost = el.scrollWidth - el.clientWidth;
    if (lost <= 1 || el.clientWidth === 0) continue;
    // VISUALLY HIDDEN IS NOT CLIPPED. The first version reported every page: the sr-only idiom is a
    // 1px box whose content is clipped ON PURPOSE (the live-region announcement, the "Skip to main
    // content" link) and is meant for a screen reader. Nothing readable fits under 8px.
    if (el.clientWidth < 8) continue;
    // A truncating line (ellipsis) is a deliberate, reversible cut — the full value is in the title
    // or on the detail page. Only report content with nowhere else to be read.
    if (cs.textOverflow === 'ellipsis') continue;
    cut.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 95),
      txt: String(el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
      lost: Math.round(lost), cw: Math.round(el.clientWidth),
    });
  }
  cut.sort((a, b) => b.lost - a.lost);

  /**
   * A COLUMN TOO NARROW TO READ. The third failure, and the one that let "Canvassing is clipped at
   * 390" sit on the owner's list through two rounds of "all widths measured clean". (T58d)
   *
   * roofing/canvassing laid its body out as a bare grid-cols-3 with no breakpoint, so at 390 the
   * three tracks were about 64px each. Both rules above passed it:
   *   · nothing OVERFLOWED the document — main is overflow-auto, so documentElement stayed at 390
   *   · the two boxes that truly lost content were truncate, skipped as a deliberate ellipsis
   * The screenshot showed "Sam QA" overlapping "0 leads" and running off the edge, "Morgan QA" gone,
   * and a script titled "H...". Compliant and unreadable.
   *
   * So: an element that holds TEXT OF ITS OWN and ends up narrower than a word is a broken layout,
   * whatever its overflow says. 110px is the threshold — about ten characters at this body size, and
   * comfortably below any real column; icon buttons, badges and number cells are excluded by
   * requiring real text and by ignoring anything with no letters.
   */
  const starved = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const cw = el.clientWidth;
    if (cw === 0 || cw >= 110) continue;
    // SCREEN-READER TEXT IS NOT A NARROW COLUMN. "Skip to main content" and the live-region
    // announcement are 1px boxes on purpose, and the first version of this rule reported both on
    // every page in the fleet. Excluded by the TECHNIQUE (absolutely positioned and clipped) rather
    // than by width alone, so a genuinely broken 20px column is still caught.
    if (cw < 8) continue;
    if (cs.position === 'absolute' && (cs.clipPath !== 'none' || (cs.clip && cs.clip !== 'auto'))) continue;
    // Its OWN text, not a descendant's — otherwise every ancestor of a long word is reported.
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent || '';
    own = own.trim().replace(/\\s+/g, ' ');
    if (own.length < 8) continue;
    if (!/[A-Za-z]{4}/.test(own)) continue;
    // Only when the text does not fit: a short label in a narrow box is fine.
    if (el.scrollWidth - cw <= 1) continue;
    starved.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 95),
      txt: own.slice(0, 40),
      cw: Math.round(cw), sw: Math.round(el.scrollWidth),
    });
  }
  starved.sort((a, b) => a.cw - b.cw);

  const txt = (document.body ? document.body.innerText : '') || '';
  return JSON.stringify({
    iw: VW, sw: de.scrollWidth, over: de.scrollWidth - VW,
    count: over.length, worst: over.filter(o => o.wider).slice(0, 3).concat(over.slice(0, 3)),
    clipped: cut.length, cut: cut.slice(0, 3),
    starved: starved.length, narrow: starved.slice(0, 3),
    sample: txt.trim().slice(0, 50).replace(/\\s+/g, ' '),
  });
})()`

const CLICK = (label: string) => `(() => {
  const want = ${JSON.stringify(label)}.toLowerCase();
  const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  const hit = els.find(x => (x.innerText || '').trim().toLowerCase() === want)
           || els.find(x => (x.innerText || '').trim().toLowerCase().includes(want));
  if (!hit) return 'no-button';
  hit.click();
  return 'clicked';
})()`

let fits = 0, bad = 0, skipped = 0, clipped = 0, starvedCount = 0
const starvedPages: string[] = []
const failures: string[] = []
const clippedPages: string[] = []
let lastOrigin = ''
for (const t of targets) {
  await cdp(ws, ++id, 'Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: WIDTH < 500 })
  if (t.origin !== lastOrigin) {
    await cdp(ws, ++id, 'Page.navigate', { url: `${t.origin}/login` })
    await new Promise((r) => setTimeout(r, 2500))
    lastOrigin = t.origin
  }
  await cdp(ws, ++id, 'Runtime.evaluate', { expression: `localStorage.setItem('accessToken', ${JSON.stringify(t.token)}); 'ok'` })
  await cdp(ws, ++id, 'Page.navigate', { url: t.url })
  await new Promise((r) => setTimeout(r, 6000))

  if (t.click) {
    let res = ''
    try {
      const c = await cdp(ws, ++id, 'Runtime.evaluate', { expression: CLICK(t.click), returnByValue: true })
      res = String(c.result.value)
      await new Promise((r) => setTimeout(r, 2000))
    } catch (e: any) { res = `err ${String(e.message).slice(0, 30)}` }
    if (res !== 'clicked') { skipped++; console.log(`!!   ${t.label.padEnd(30)} could not switch view (${res})`); continue }
  }

  let v: any
  try {
    const res = await cdp(ws, ++id, 'Runtime.evaluate', { expression: EXPR, returnByValue: true })
    v = JSON.parse(res.result.value)
  } catch (e: any) { console.log(`ERR  ${t.label.padEnd(30)} ${String(e.message).slice(0, 48)}`); skipped++; continue }
  if (/sign in to your account|forgot password/i.test(v.sample)) { console.log(`!!   ${t.label.padEnd(30)} bounced to login`); skipped++; continue }
  if (v.over > 1) {
    bad++
    failures.push(t.label)
    console.log(`FAIL ${t.label.padEnd(30)} +${v.over}px  (sw ${v.sw} vs ${v.iw})  ${v.count} el`)
    const seen = new Set<string>()
    for (const o of v.worst) {
      const k = `${o.tag}|${o.cls}|${o.w}`
      if (seen.has(k)) continue
      seen.add(k)
      console.log(`       ${o.wider ? 'WIDER THAN PARENT ' : 'pushed out        '}<${o.tag} w=${o.w} parent=${o.pw} right=${o.right}> "${o.txt}"`)
      console.log(`         class="${o.cls}"`)
    }
  } else { fits++; console.log(`ok   ${t.label.padEnd(30)} fits (sw ${v.sw})`) }

  // …and separately, content being LOST inside an unscrollable box. A page can fit perfectly and
  // still be hiding half a table. See the note in EXPR. (T51 follow-up)
  if (v.clipped > 0) {
    clipped++
    clippedPages.push(t.label)
    console.log(`CLIP ${t.label.padEnd(30)} ${v.clipped} box(es) cutting content off with no scroll`)
    for (const c of v.cut) {
      console.log(`       <${c.tag} visible=${c.cw}px losing=${c.lost}px> "${c.txt}"`)
      console.log(`         class="${c.cls}"`)
    }
  }

  // …and a third way to be broken: a column squeezed too narrow to read, which neither of the above
  // can see because the page does not overflow and the box does not clip. See the note in EXPR.
  if (v.starved > 0) {
    starvedCount++
    starvedPages.push(t.label)
    console.log(`NARROW ${t.label.padEnd(28)} ${v.starved} element(s) too narrow for their own text`)
    for (const n of v.narrow) {
      console.log(`       <${n.tag} ${n.cw}px wide, needs ${n.sw}px> "${n.txt}"`)
      console.log(`         class="${n.cls}"`)
    }
  }
}
ws.close()
console.log(`\n${WIDTH}px: ${fits} fit, ${bad} overflow, ${clipped} clipping content, ${starvedCount} too narrow, ${skipped} not measured`)
if (failures.length) console.log(`overflowing: ${failures.join(', ')}`)
if (clippedPages.length) console.log(`clipping:    ${clippedPages.join(', ')}`)
if (starvedPages.length) console.log(`too narrow:  ${starvedPages.join(', ')}`)
