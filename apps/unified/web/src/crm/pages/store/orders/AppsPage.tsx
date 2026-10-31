// Apps & integrations at /crm/apps (parity row 8 against Shopify's app list, webhooks and Admin API, 2026-10-31).
//   · the catalogue: every account the shop connects (payments, shipping, supplier, QuickBooks, email, reviews, Google and Meta), whether it
//     is connected, its settings in a few words, and where to change it — GET /api/admin/apps (store_apps);
//   · Store API: keys, each limited to what it may read or change; a key is shown once (store_api, /api/admin/store-api-keys);
//   · Webhooks: the addresses the shop posts its events to, a test message, a new signing secret, and the delivery log with "Send again"
//     (store_webhooks, /api/admin/store-webhooks).
// Behind integrations:update (the server asks it of all three). A panel appears only when its own feature is on. Not shown, and why: other
// companies' apps — that is an outside party's marketplace (the note on the page says so).
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plug } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useAuth, useConfirm, useMayWrite } from '../../../../shared'

interface App { id: string; name: string; group: string; description: string; state: 'connected' | 'not_connected' | 'off'; stateLabel: string; settings: Array<{ label: string; value: string }>; manage: { label: string; to: string } }
interface Catalogue { apps: App[]; groups: string[]; zone: string; outsideParty: string }
interface Key { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
interface Hook { id: string; url: string; events: Array<{ id: string; label: string }>; active: boolean; lastDeliveryAt: string | null; lastStatus: number | null; failureCount: number }
interface Delivery { id: string; webhookId: string; event: string; eventLabel: string; status: string; statusLabel: string; attempts: number; responseStatus: number | null; error: string | null; nextAttemptAt: string | null; createdAt: string }

const BADGE = { connected: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300', not_connected: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300', off: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300' } as const
const when = (t: string | null) => (t ? whenDateTime(t) : 'Never')
const field = 'input mt-1 w-full'

export default function AppsPage() {
  const { hasFeature } = useAuth()
  const [cat, setCat] = useState<Catalogue | null>(null)
  const [loadError, setLoadError] = useState('')
  const load = useCallback(async () => {
    try { setCat((await api.get('/api/admin/apps')) as Catalogue); setLoadError('') } catch (e) { setLoadError(errorText(e, "Couldn't load your apps")) }
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2"><Plug className="h-6 w-6" aria-hidden="true" />Apps &amp; integrations</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">Everything your shop connects to, in one place: whether it is connected, how it is set, and where to change it.</p>
      </div>
      {loadError ? <PageError message={`${loadError} — refresh to try again.`} /> : !cat ? <p className="text-gray-500 dark:text-slate-400">Loading…</p> : (
        <>
          {cat.groups.map((g) => (
            <section key={g} className="space-y-3" aria-label={g}>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{g}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {cat.apps.filter((a) => a.group === g).map((a) => (
                  <article key={a.id} className="card p-4 space-y-2" aria-label={a.name}>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-gray-900 dark:text-slate-100">{a.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${BADGE[a.state]}`}>{a.stateLabel}</span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-slate-400">{a.description}</p>
                    {a.settings.length > 0 && (
                      <dl className="text-sm grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                        {a.settings.map((s) => <div key={s.label} className="contents"><dt className="text-gray-500 dark:text-slate-400">{s.label}</dt><dd className="text-gray-900 dark:text-slate-100">{s.value}</dd></div>)}
                      </dl>
                    )}
                    {a.manage.to.startsWith('#')
                      ? <a href={a.manage.to} className="text-sm text-emerald-800 dark:text-emerald-300 underline">{a.manage.label}</a>
                      : <Link to={a.manage.to} className="text-sm text-emerald-800 dark:text-emerald-300 underline">{a.manage.label}</Link>}
                  </article>
                ))}
              </div>
            </section>
          ))}
          {hasFeature('store_api') && <ApiKeysPanel onChange={load} />}
          {hasFeature('store_webhooks') && <WebhooksPanel onChange={load} />}
          <p className="text-sm text-gray-500 dark:text-slate-400">{cat.outsideParty}</p>
        </>
      )}
    </div>
  )
}

// ── Store API keys ───────────────────────────────────────────────────────────────────────────────────────────────
function ApiKeysPanel({ onChange }: { onChange: () => void }) {
  const may = useMayWrite('integrations:update')
  const confirm = useConfirm()
  const [keys, setKeys] = useState<Key[] | null>(null)
  const [scopes, setScopes] = useState<Array<{ id: string; label: string }>>([])
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { const r: any = await api.get('/api/admin/store-api-keys'); setKeys(r.keys); setScopes(r.scopes); setError('') } catch (e) { setError(errorText(e, "Couldn't load your keys")) }
  }, [])
  useEffect(() => { void load() }, [load])
  const label = (id: string) => scopes.find((s) => s.id === id)?.label ?? id

  const make = async () => {
    setBusy(true); setError(''); setSecret('')
    try { const r: any = await api.post('/api/admin/store-api-keys', { name, scopes: picked }); setSecret(r.secret); setName(''); setPicked([]); await load(); onChange() }
    catch (e) { setError(errorText(e, "Couldn't make the key")) } finally { setBusy(false) }
  }
  const revoke = async (k: Key) => {
    if (!(await confirm(`Revoke the key “${k.name}”? Anything using it stops working at once. This cannot be undone.`, { title: 'Revoke key', confirmText: 'Revoke' }))) return
    setError('')
    try { await api.delete(`/api/admin/store-api-keys/${k.id}`); await load(); onChange() } catch (e) { setError(errorText(e, "Couldn't revoke the key")) }
  }

  return (
    <section id="store-api" className="card p-4 sm:p-6 space-y-3" aria-label="Store API">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Store API</h2>
      <p className="text-sm text-gray-600 dark:text-slate-400">
        Let a script or another system read your products, orders, customers and stock, or change stock counts. Each key can do only what you tick, and sees nothing about what things cost you.
        Send it as <code>Authorization: Bearer your-key</code> to <code>{typeof window !== 'undefined' ? window.location.origin : ''}/api/store/v1/products</code> (also <code>orders</code>, <code>customers</code>, <code>inventory</code>). 120 requests a minute per key.
      </p>
      {error && <PageError message={error} />}
      {secret && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 p-3 space-y-1">
          <p className="text-sm font-medium text-gray-900 dark:text-slate-100">Copy your key now. It is shown only this once.</p>
          <code className="block break-all text-sm select-all">{secret}</code>
        </div>
      )}
      {keys && keys.length > 0 && (
        <ul className="divide-y divide-gray-200 dark:divide-slate-700">
          {keys.map((k) => (
            <li key={k.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{k.name} <span className="font-normal text-gray-500 dark:text-slate-400">{k.prefix}…</span>{k.revokedAt && <span className="ml-2 text-xs text-red-700 dark:text-red-300">Revoked</span>}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">{k.scopes.map(label).join(', ')} · last used {when(k.lastUsedAt)}</p>
              </div>
              {!k.revokedAt && may && <button type="button" className="px-3 py-1.5 text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg" onClick={() => void revoke(k)}>Revoke</button>}
            </li>
          ))}
        </ul>
      )}
      {keys && !keys.length && <p className="text-sm text-gray-600 dark:text-slate-400">No keys yet.</p>}
      {may && (
        <fieldset className="space-y-2" disabled={busy}>
          <legend className="text-sm font-medium text-gray-900 dark:text-slate-100">Make a key</legend>
          <label className="block max-w-sm text-sm text-gray-700 dark:text-slate-300">What will use it?
            <input className={field} value={name} maxLength={60} placeholder="Warehouse spreadsheet" onChange={(e) => setName(e.target.value)} /></label>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {scopes.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />{s.label}
              </label>
            ))}
          </div>
          <button type="button" className="btn-primary" disabled={!name.trim() || !picked.length} onClick={() => void make()}>Make key</button>
        </fieldset>
      )}
    </section>
  )
}

// ── Webhooks ─────────────────────────────────────────────────────────────────────────────────────────────────────
function WebhooksPanel({ onChange }: { onChange: () => void }) {
  const may = useMayWrite('integrations:update')
  const confirm = useConfirm()
  const [hooks, setHooks] = useState<Hook[] | null>(null)
  const [events, setEvents] = useState<Array<{ id: string; label: string }>>([])
  const [log, setLog] = useState<Delivery[]>([])
  const [note, setNote] = useState('')
  const [url, setUrl] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [secret, setSecret] = useState('')
  const [result, setResult] = useState('')
  const [body, setBody] = useState<{ id: string; text: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const load = useCallback(async () => {
    try { const r: any = await api.get('/api/admin/store-webhooks'); setHooks(r.webhooks); setEvents(r.events); setLog(r.deliveries); setNote(r.retryNote); setError('') } catch (e) { setError(errorText(e, "Couldn't load your webhooks")) }
  }, [])
  useEffect(() => { void load() }, [load])
  const run = async (key: string, fn: () => Promise<void>, fallback: string) => { setBusy(key); setError(''); try { await fn() } catch (e) { setError(errorText(e, fallback)) } finally { setBusy('') } }
  const addressOf = (id: string) => hooks?.find((h) => h.id === id)?.url ?? 'a removed address'

  const add = () => run('add', async () => { const r: any = await api.post('/api/admin/store-webhooks', { url, events: picked }); setSecret(r.secret); setUrl(''); setPicked([]); setResult(''); await load(); onChange() }, "Couldn't add the address")
  const toggle = (h: Hook) => run(`on-${h.id}`, async () => { await api.patch(`/api/admin/store-webhooks/${h.id}`, { active: !h.active }); await load(); onChange() }, "Couldn't change the address")
  const test = (h: Hook) => run(`test-${h.id}`, async () => { const r: any = await api.post(`/api/admin/store-webhooks/${h.id}/test`); setResult(r.ok ? `${h.url} answered ${r.status}: the test message arrived.` : `${h.url} did not accept the test: ${r.error || 'no answer'}`); await load() }, "Couldn't send the test")
  const rotate = async (h: Hook) => {
    if (!(await confirm('Make a new signing secret? The old one stops working at once, so update the receiver straight after.', { title: 'New signing secret', confirmText: 'Make new secret' }))) return
    await run(`rot-${h.id}`, async () => { const r: any = await api.post(`/api/admin/store-webhooks/${h.id}/secret`); setSecret(r.secret) }, "Couldn't make a new secret")
  }
  const remove = async (h: Hook) => {
    if (!(await confirm(`Stop sending to ${h.url}? Its delivery log goes with it.`, { title: 'Remove address', confirmText: 'Remove' }))) return
    await run(`del-${h.id}`, async () => { await api.delete(`/api/admin/store-webhooks/${h.id}`); await load(); onChange() }, "Couldn't remove the address")
  }
  const again = (d: Delivery) => run(`again-${d.id}`, async () => { const r: any = await api.post(`/api/admin/store-webhooks/deliveries/${d.id}/send-again`); setResult(r.ok ? 'Delivered.' : `Still not accepted: ${r.error || 'no answer'}`); await load() }, "Couldn't send it again")
  const show = (d: Delivery) => run(`body-${d.id}`, async () => { const r: any = await api.get(`/api/admin/store-webhooks/deliveries/${d.id}`); let text = r.body; try { text = JSON.stringify(JSON.parse(r.body), null, 2) } catch { /* shown as sent */ } setBody({ id: d.id, text }) }, "Couldn't open the delivery")

  return (
    <section id="store-webhooks" className="card p-4 sm:p-6 space-y-3" aria-label="Webhooks">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Webhooks</h2>
      <p className="text-sm text-gray-600 dark:text-slate-400">
        Your shop tells an address you choose when something happens, so another system can follow along. An order is told as <strong>created</strong> and <strong>paid</strong> together when payment arrives (a checkout nobody paid for is not an order). Each message is signed: check the <code>X-Twomiah-Signature</code> header with your signing secret. {note}
      </p>
      {error && <PageError message={error} />}
      {secret && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 p-3 space-y-1">
          <p className="text-sm font-medium text-gray-900 dark:text-slate-100">Copy the signing secret now. It is shown only this once.</p>
          <code className="block break-all text-sm select-all">{secret}</code>
        </div>
      )}
      {result && <p role="status" className="text-sm text-gray-700 dark:text-slate-300">{result}</p>}
      {hooks && hooks.length > 0 && (
        <ul className="divide-y divide-gray-200 dark:divide-slate-700">
          {hooks.map((h) => (
            <li key={h.id} className="py-3 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100 break-all">{h.url} {!h.active && <span className="ml-1 text-xs font-normal text-gray-500 dark:text-slate-400">Switched off</span>}</p>
                {may && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => void test(h)}>Send a test</button>
                    <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => void toggle(h)}>{h.active ? 'Switch off' : 'Switch on'}</button>
                    <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => void rotate(h)}>New secret</button>
                    <button type="button" className="px-3 py-2 text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg" disabled={!!busy} onClick={() => void remove(h)}>Remove</button>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400">{h.events.map((e) => e.label).join(', ')} · last delivery {when(h.lastDeliveryAt)}{h.failureCount > 0 ? ` · ${h.failureCount} failed in a row` : ''}</p>
            </li>
          ))}
        </ul>
      )}
      {hooks && !hooks.length && <p className="text-sm text-gray-600 dark:text-slate-400">No addresses yet.</p>}
      {may && (
        <fieldset className="space-y-2" disabled={busy === 'add'}>
          <legend className="text-sm font-medium text-gray-900 dark:text-slate-100">Add an address</legend>
          <label className="block max-w-xl text-sm text-gray-700 dark:text-slate-300">Address (https)
            <input className={field} value={url} placeholder="https://example.com/hooks/shop" onChange={(e) => setUrl(e.target.value)} /></label>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {events.map((ev) => (
              <label key={ev.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input type="checkbox" checked={picked.includes(ev.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, ev.id] : p.filter((x) => x !== ev.id)))} />{ev.label}
              </label>
            ))}
          </div>
          <button type="button" className="btn-primary" disabled={!url.trim() || !picked.length} onClick={() => void add()}>Add address</button>
        </fieldset>
      )}
      <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100 pt-2">Delivery log</h3>
      {!log.length ? <p className="text-sm text-gray-600 dark:text-slate-400">Nothing has been sent yet.</p> : (
        <ul className="divide-y divide-gray-200 dark:divide-slate-700">
          {log.map((d) => (
            <li key={d.id} className="py-2 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-gray-900 dark:text-slate-100">
                  <span className={d.status === 'delivered' ? 'text-green-700 dark:text-green-400' : d.status === 'pending' ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'}>{d.statusLabel}</span> · {d.eventLabel} · {addressOf(d.webhookId)}
                </p>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => void show(d)}>See message</button>
                  {may && d.status !== 'delivered' && <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => void again(d)}>Send again</button>}
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400">{when(d.createdAt)} · {d.attempts} {d.attempts === 1 ? 'try' : 'tries'}{d.responseStatus ? ` · answered ${d.responseStatus}` : ''}{d.error ? ` · ${d.error}` : ''}{d.status === 'pending' && d.nextAttemptAt ? ` · next try ${when(d.nextAttemptAt)}` : ''}</p>
              {body?.id === d.id && <pre className="text-xs overflow-x-auto rounded bg-gray-50 dark:bg-slate-900 p-2">{body.text}</pre>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
