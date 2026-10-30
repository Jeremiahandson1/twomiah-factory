// The demo's entry. It does four things, in this order, and only then lets the real CRM start:
//   1. which trade (?trade=… from the /demo page, kept for this tab), else back to the list;
//   2. the lock (guard.ts) — before any CRM code runs, so nothing the CRM does can reach the network;
//   3. the recorded data for the trade, and what the real server writes into the page (the business's name, colours and the
//      trade's screen settings), so the CRM reads them exactly as it does from the real server;
//   4. the banner, then the CRM's own main.tsx, unchanged.
import { tradeById } from '../../demo/trades'
import { installGuard } from './guard'
import { handle } from './router'
import { DemoStore, type DemoData } from './store'
import { mountBanner, showNotice } from './ui'

const KEY = 'twomiah-demo-trade'

function chosenTrade(): string | null {
  const params = new URLSearchParams(location.search)
  const asked = params.get('trade')
  try {
    if (asked) sessionStorage.setItem(KEY, asked)
    const id = asked ?? sessionStorage.getItem(KEY)
    if (asked) {
      params.delete('trade')
      history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash)
    }
    return id
  } catch { return asked }
}

async function start() {
  const trade = tradeById(chosenTrade())
  if (!trade) { location.replace('/'); return }

  // What the tests read: every call the demo could not answer, and every notice it showed.
  const log = { unavailable: [] as string[], notices: [] as string[] }
  const notice = (message: string) => { log.notices.push(message); showNotice(message) }
  let store: DemoStore | null = null
  const guard = installGuard({
    respond: (req) => {
      const r = handle(store!, req, () => location.assign('/'))
      if ((r.body as { code?: string } | null)?.code === 'DEMO_UNAVAILABLE') log.unavailable.push(`${req.method} ${req.url.pathname}${req.url.search}`)
      return r
    },
    notice,
  })
  const res = await guard.readData(`/demo-data/${trade.id}.json`)
  if (!res.ok) { document.body.textContent = 'The demo data could not be loaded. Please go back and try again.'; return }
  const data = (await res.json()) as DemoData
  store = new DemoStore(data)
  store.notify = notice

  // What the real server writes into the page (server/http/adminScreens.ts).
  const { page } = data
  document.title = page.title
  const meta = (name: string, content: string) => { const m = document.createElement('meta'); m.name = name; m.content = content; document.head.appendChild(m) }
  meta('company-name', page.companyName); meta('brand-primary', page.brandPrimary); meta('brand-secondary', page.brandSecondary); meta('company-email', page.companyEmail)
  const screens = document.createElement('script')
  screens.type = 'application/json'
  screens.id = 'vertical-screens'
  screens.textContent = JSON.stringify(page.screens).replace(/</g, '\\u003c')
  document.head.appendChild(screens)

  mountBanner(() => {
    store!.reset()
    // The CRM keeps a few settings of its own in the browser (a dismissed card, the theme): the demo starts clean, but the trade stays.
    try { const keep = sessionStorage.getItem(KEY); sessionStorage.clear(); if (keep) sessionStorage.setItem(KEY, keep) } catch { /* private mode */ }
    try { const theme = localStorage.getItem('theme'); localStorage.clear(); if (theme) localStorage.setItem('theme', theme) } catch { /* private mode */ }
    location.reload()
  })

  // Exposed for the tests only: reads and changes of the in-memory data.
  ;(window as any).__demo = { store, trade: trade.id, log }

  await import('../src/main')
}

void start()
