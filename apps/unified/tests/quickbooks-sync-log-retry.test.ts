// QuickBooks' sync log (web/src/crm/quickbooksSyncLog.tsx, fix-m) drew "Retry now" on each refused record for every
// seat. The retry is POST /api/qb-sync/failures/:id/retry, which asks settings:update (server
// crm/office/quickbooksSyncRoutes.ts): a seat without it was offered a control the server refuses. Found when batch 3 put
// fix-m's screen under fix-l's write-controls guard (scripts/check-unified-write-controls.ts). The log is rendered here in
// a browser-like window, its reply answered, and the Retry control is drawn only for a seat holding settings:update.
import { test, expect, beforeAll } from 'bun:test'
import { Window } from 'happy-dom'

let win: any
beforeAll(() => {
  win = new Window({ url: 'https://tenant.test/crm/settings/integrations' })
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'getComputedStyle', 'MutationObserver', 'localStorage']) {
    ;(globalThis as any)[k] = k === 'window' ? win : win[k]
  }
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const LOG = {
  connected: true, autoSync: true, everyMinutes: 15,
  runs: [{ id: 'r1', trigger: 'auto', status: 'partial', customers: 1, invoices: 0, payments: 0, failed: 1, error: null, startedAt: '2026-10-24T12:00:00Z' }],
  failures: [{ id: 'f1', entity: 'invoice', label: 'INV-7', attempts: 2, lastError: 'Duplicate Document Number', nextAttemptAt: null, gaveUp: false }],
}

async function render(permissions: string[]) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act } = React as any
  // By paths held in variables: the server's tsconfig (which checks the tests) compiles no JSX.
  const LOGFILE: string = '../web/src/crm/quickbooksSyncLog.tsx'
  const SHARED: string = '../web/src/shared'
  const { QuickBooksSyncLog } = (await import(LOGFILE)) as any
  const { PermissionsProvider, ToastProvider } = (await import(SHARED)) as any
  const realFetch = globalThis.fetch
  ;(globalThis as any).fetch = async (url: any) => {
    if (String(url).includes('/api/qb-sync/log')) return new Response(JSON.stringify(LOG), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
  }
  const host = win.document.createElement('div')
  win.document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(React.createElement(ToastProvider, null,
        React.createElement(PermissionsProvider, { role: 'manager', permissions },
          React.createElement(QuickBooksSyncLog))))
    })
    for (let i = 0; i < 20 && !host.querySelector('[data-testid="qb-sync-log"]'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    const text = host.textContent || ''
    const retry = [...host.querySelectorAll('button')].filter((b: any) => (b.textContent || '').includes('Retry now'))
    return { text, retries: retry.length }
  } finally {
    await act(async () => root.unmount())
    host.remove()
    ;(globalThis as any).fetch = realFetch
  }
}

test('a seat holding settings:update sees the refused record and its Retry now', async () => {
  const r = await render(['settings:read', 'settings:update', 'invoices:read'])
  expect(r.text).toContain('Duplicate Document Number')
  expect(r.retries).toBe(1)
})

test('a seat without settings:update sees the refused record, and no Retry it would be refused', async () => {
  const r = await render(['settings:read', 'invoices:read'])
  expect(r.text).toContain('Duplicate Document Number')
  expect(r.retries).toBe(0)
})
