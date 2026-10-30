// Walks the built demo in a real browser, the way a visitor would: every screen in the menu, two rows of each list, each tab.
// Reports what a visitor could hit: a call the demo could not answer, a screen that fell into the error page, a script error,
// and any request that left the demo's own host. Used by tests/demo/walk.test.ts and by hand:
//   cd apps/unified && bun run build:demo && bun demo/walk.ts contractor
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Browser, type CDPSession, type Page } from 'playwright-core'
import { serveDemo } from './serve.ts'
import { DEMO_TRADES } from './trades.ts'

export interface WalkReport {
  trade: string
  pages: string[]
  /** Calls the demo answered "not available", with the page they were made on. */
  unavailable: string[]
  /** Pages that showed the error page. */
  errorPages: string[]
  pageErrors: string[]
  /** Anything requested from another host than the demo's. */
  outside: string[]
  /** Pages whose own text says something is not available in the demo. */
  unavailableText: string[]
}

const SKIP = [/\/crm\/kiosk/, /logout/i]
const MAX_PAGES = 160
/** A screen that has not finished in this long has stopped answering: a page whose script never returns holds every browser step,
 *  and no step limit fires (CI 10/30: each trade's phone walk stopped on one screen and ran out its 15 minutes). */
const STALL_MS = 60_000

const within = <T>(p: Promise<T>, ms: number): Promise<T | undefined> => {
  let t: ReturnType<typeof setTimeout> | undefined
  return Promise.race([p, new Promise<undefined>((r) => { t = setTimeout(() => r(undefined), ms) })]).finally(() => clearTimeout(t))
}

/**
 * A browser of the walk's own, driven over its DevTools websocket instead of Playwright's pipe. CI 10/30, with
 * DEBUG=pw:browser: every phone walk's browser logged "Connection terminated while reading from pipe" a few seconds in and
 * exited cleanly (exitCode=0) — its end of the pipe was closed under it — and Playwright, never told, waited on it until
 * the stall limit. No pipe here: the browser's output goes nowhere, and the connection is a websocket.
 */
async function launchOverWebSocket(): Promise<{ browser: Browser; stop: () => Promise<void> }> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
  const port = probe.port
  probe.stop(true)
  const profile = mkdtempSync(path.join(os.tmpdir(), 'demo-walk-'))
  const proc = Bun.spawn([chromium.executablePath(), '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'],
  { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  let ws = ''
  for (let i = 0; i < 100 && !ws; i++) {
    ws = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).then((j: any) => j.webSocketDebuggerUrl || '').catch(() => '')
    if (!ws) await new Promise((r) => setTimeout(r, 100))
  }
  if (!ws) { proc.kill(); throw new Error('the walk\'s browser did not start (no DevTools address in 10s)') }
  const browser = await chromium.connectOverCDP(ws)
  return {
    browser,
    stop: async () => {
      await within(browser.close(), 10_000)
      proc.kill()
      await within(proc.exited, 5_000)
      try { rmSync(profile, { recursive: true, force: true }) } catch { /* the folder is a temp one */ }
    },
  }
}

export async function walkDemo(opts: { base: string; trade: string; viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark'; maxPages?: number; page?: Page }): Promise<WalkReport> {
  const own = !opts.page
  const launched = own ? await launchOverWebSocket() : null
  const browser = launched?.browser ?? null
  const context = own ? await browser!.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 }, colorScheme: opts.colorScheme ?? 'light' }) : null
  let page = opts.page ?? (await context!.newPage())
  const started = Date.now()
  const report: WalkReport = { trade: opts.trade, pages: [], unavailable: [], errorPages: [], pageErrors: [], outside: [], unavailableText: [] }
  let here = ''
  /** The browser step in progress, and the last things the page did: what a stall report names. */
  let step = ''
  const recent: string[] = []
  const note = (what: string) => { recent.push(`${((Date.now() - started) / 1000).toFixed(1)}s ${what}`); if (recent.length > 8) recent.shift() }
  let stalled = false
  // The debugger is switched on while the page still answers: a page already stuck never answers "enable", only "pause".
  let cdp: CDPSession | null = null
  const attach = (p: Page) => {
    cdp = null
    p.context().newCDPSession(p).then(async (s) => { await s.send('Debugger.enable'); cdp = s }).catch(() => {})
    // Every browser step has a limit, so a screen that stalls is reported by name instead of running out the test's 15 minutes
    // with nothing said (CI 10/30: the phone walks did, in every trade, and walked in 93 s on a desktop machine).
    p.setDefaultTimeout(15_000)
    p.setDefaultNavigationTimeout(30_000)
    p.on('pageerror', (e) => report.pageErrors.push(`${here}: ${e.message.slice(0, 160)}`))
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) note(`navigated ${f.url().replace(opts.base, '')}`) })
    p.on('popup', (w) => { note(`popup ${w.url()}`); w.close().catch(() => {}) })
    p.on('download', (d) => note(`download ${d.suggestedFilename()}`))
    p.on('dialog', (d) => { note(`dialog ${d.type()} "${d.message().slice(0, 60)}"`); d.dismiss().catch(() => {}) })
    p.on('console', (m) => { if (m.type() === 'error') note(`console ${m.text().slice(0, 80)}`) })
    p.on('request', (r) => {
      const u = r.url()
      if (!u.startsWith(opts.base) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:')) report.outside.push(`${here}: ${u}`)
    })
  }
  attach(page)

  // Where a page's script is stuck: paused through the browser's debugger, the way DevTools pauses a page that never returns,
  // with the calls that led there and the code around the stop.
  const whereStuck = async (): Promise<string> => {
    try {
      if (!cdp) return 'the debugger was not ready on this page'
      const paused = new Promise<any>((r) => cdp!.once('Debugger.paused', r))
      cdp.send('Debugger.pause').catch(() => {})
      const ev = await within(paused, 10_000)
      if (!ev) return 'no script was running (the browser itself did not answer)'
      const frames = (ev.callFrames as any[]).slice(0, 8).map((f) => `${f.functionName || '(anonymous)'} ${String(f.url).replace(opts.base, '')}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`)
      const top = ev.callFrames[0]
      const src = (await within(cdp.send('Debugger.getScriptSource', { scriptId: top.location.scriptId }), 10_000))?.scriptSource ?? ''
      const line = src.split('\n')[top.location.lineNumber] ?? ''
      const near = line.slice(Math.max(0, top.location.columnNumber - 240), top.location.columnNumber + 240)
      return `stuck in ${frames.join(' <- ')} | code: ${near}`
    } catch (e) { return `could not look: ${(e as Error).message.slice(0, 160)}` }
  }
  /** One screen's work, given STALL_MS. A stall is reported with the step it stopped on, what the page did just before, and
   *  where its script was; then the walk ends (CI 10/30: after a stall even a new page in the same browser never opened). */
  const guarded = async <T>(href: string, run: () => Promise<T>): Promise<T | undefined> => {
    const work = run()
    work.catch(() => {})
    const done = await within(work.then((v) => ({ v })), STALL_MS)
    if (done) return done.v
    stalled = true
    const where = await whereStuck()
    const fresh = await within(page.context().browser()!.newContext().then(async (c) => { const p = await c.newPage(); await p.goto(`${opts.base}/`); c.close().catch(() => {}); return 'a fresh browser tab still opened' }), 10_000).catch(() => undefined)
    const said = `stopped answering for ${STALL_MS / 1000}s during "${step}" at ${page.url().replace(opts.base, '')} — ${where}; ${fresh ?? 'the whole browser had stopped too'}; just before: ${recent.join(' | ')}`
    report.pageErrors.push(`${href}: ${said}`)
    console.log(`  [walk ${opts.trade} ${opts.viewport?.width ?? 1440}px] ${href} STALLED — ${said}`)
    // What the machine says at that moment: every process (state R running, S sleeping, D waiting on the disk, Z exited,
    // its CPU, memory and what it waits in) — the first run listed no browser process at all; the kernel's last lines (a
    // crash or an out-of-memory kill is written there); the free and shared memory.
    if (process.platform === 'linux') {
      const sh = (cmd: string) => { try { const r = Bun.spawnSync(['sh', '-c', cmd]); return (r.stdout.toString() + r.stderr.toString()).trim() } catch (e) { return String(e) } }
      console.log(`  [walk ${opts.trade}] processes:\n${sh('ps -eo pid,ppid,stat,pcpu,rss,wchan:24,args --sort=-pcpu | cut -c1-220 | head -30')}`)
      console.log(`  [walk ${opts.trade}] kernel:\n${sh('sudo -n dmesg -T 2>&1 | tail -20')}`)
      console.log(`  [walk ${opts.trade}] memory:\n${sh('free -m; df -h /dev/shm')}`)
    }
    return undefined
  }

  const links = async () => [...new Set(await page.$$eval('a[href^="/crm"]', (as) => as.map((a) => (a.getAttribute('href') || '').split('#')[0])))].filter(Boolean)
  const drained = async () => page.evaluate(() => { const l = (window as any).__demo?.log; if (!l) return []; const out = l.unavailable.slice(); l.unavailable.length = 0; return out as string[] })
  const visit = async (href: string, first = false) => {
    here = href
    try {
      step = 'goto'
      await page.goto(first ? `${opts.base}${href}?trade=${opts.trade}` : `${opts.base}${href}`, { waitUntil: 'networkidle', timeout: 30_000 })
      await page.waitForTimeout(350)
      step = 'tabs'
      for (const tab of (await page.$$('[role="tab"]')).slice(0, 8)) { step = `tab ${await tab.innerText().catch(() => '?')}`; try { await tab.click({ timeout: 1500 }); await page.waitForTimeout(300) } catch { /* not clickable now */ } }
      // A list whose rows open on a click: the first row is opened, as a visitor would.
      const here0 = page.url()
      try {
        step = 'first row click'
        await page.locator('tbody tr').first().click({ timeout: 1200 })
        await page.waitForTimeout(450)
        const opened = await page.innerText('body').catch(() => '')
        if (/Something went wrong/.test(opened)) report.errorPages.push(`${href} (first row)`)
        if (page.url() !== here0) { step = 'back from the row'; await page.goBack({ waitUntil: 'networkidle' }) }
        else { step = 'Escape after the row'; await page.keyboard.press('Escape') }
      } catch { /* no rows, or not clickable */ }
      step = 'reading the page'
      const text = await page.innerText('body').catch(() => '')
      if (/Something went wrong/.test(text)) report.errorPages.push(href)
      if (/not available in the demo/i.test(text)) report.unavailableText.push(href)
      step = 'reading the demo log'
      for (const u of await drained()) report.unavailable.push(`${u}  (on ${href})`)
    } catch (e) { report.pageErrors.push(`${href}: ${(e as Error).message.slice(0, 120)}`) }
  }

  const nav = ((await guarded('/crm', async () => { await visit('/crm', true); step = 'reading the links'; return links() })) ?? []).filter((h) => !SKIP.some((re) => re.test(h)))
  const visited = new Set<string>(['/crm'])
  const perSection = new Map<string, number>()
  const queue = [...nav]
  while (!stalled && queue.length && visited.size < (opts.maxPages ?? MAX_PAGES)) {
    const href = queue.shift()!
    if (visited.has(href)) continue
    visited.add(href)
    const t = Date.now()
    const found0 = await guarded(href, async () => { await visit(href); step = 'reading the links'; return links() })
    const took = (Date.now() - t) / 1000
    if (process.env.DEMO_WALK_LOG || took > 20) console.log(`  [walk ${opts.trade} ${opts.viewport?.width ?? 1440}px] ${href} ${took.toFixed(1)}s (${visited.size} screens, ${((Date.now() - started) / 1000).toFixed(0)}s in)`)
    for (const found of found0 ?? []) {
      if (visited.has(found) || queue.includes(found) || SKIP.some((re) => re.test(found))) continue
      const section = found.split('/').slice(0, 3).join('/')
      if ((perSection.get(section) ?? 0) >= 2) continue
      perSection.set(section, (perSection.get(section) ?? 0) + 1)
      queue.push(found)
    }
  }
  report.pages = [...visited]
  if (launched) await launched.stop()
  return report
}

if (import.meta.main) {
  const wanted = process.argv.slice(2)
  const server = serveDemo()
  const base = `http://localhost:${server.port}`
  let bad = 0
  for (const trade of DEMO_TRADES.filter((t) => !wanted.length || wanted.includes(t.id))) {
    const r = await walkDemo({ base, trade: trade.id })
    console.log(`${trade.id}: ${r.pages.length} pages — ${r.unavailable.length} unanswered, ${r.errorPages.length} error pages, ${r.pageErrors.length} script errors, ${r.outside.length} outside requests`)
    for (const line of [...new Set(r.unavailable)]) console.log(`   unanswered: ${line}`)
    for (const line of r.errorPages) console.log(`   error page: ${line}`)
    for (const line of r.unavailableText) console.log(`   says unavailable: ${line}`)
    for (const line of r.pageErrors) console.log(`   script error: ${line}`)
    for (const line of r.outside) console.log(`   OUTSIDE: ${line}`)
    bad += r.unavailable.length + r.errorPages.length + r.pageErrors.length + r.outside.length
  }
  server.stop(true)
  process.exit(bad ? 1 : 0)
}
