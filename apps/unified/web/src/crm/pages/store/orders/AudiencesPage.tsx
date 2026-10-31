// The store's audiences and purchase tags at /crm/audiences (parity row 7 against Shopify Audiences and the Facebook & Google
// channels, 2026-10-31): send a saved segment to Meta or Google Ads as a hashed audience (a file to upload, or sent straight to
// the account), and report purchases to Meta (pixel + Conversions API) and Google Tag Manager.
//
// /api/admin/audiences (server/crm/store/audiences/routes.ts) — behind the store_audiences feature and marketing:update, as this
// page's menu row is; the connection form saves with integrations:update (the server refuses a seat without it).
//   · nothing readable leaves the shop: the files and the pushes carry hashes; customers who unsubscribed are left out and counted;
//   · a secret is never shown again — "Saved" says it is there; leave the box empty to keep it;
//   · a failed read, save, download or send says so in words, with the platform's own sentence.
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'
import { useCallback, useEffect, useState } from 'react'
import { Megaphone } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useMayWrite } from '../../../../shared'

interface View {
  purchaseEventsOn: boolean
  meta: { pixelId: string | null; capiOn: boolean; capiTokenSet: boolean; testEventCode: string | null; adAccountId: string | null; accessTokenSet: boolean; canPush: boolean }
  google: { tagManagerId: string | null; customerId: string | null; loginCustomerId: string | null; clientId: string | null; developerTokenSet: boolean; clientSecretSet: boolean; refreshTokenSet: boolean; canPush: boolean }
  log: Array<{ id: string; platform: string; kind: string; people: number; status: string; detail: string | null; createdAt: string }>
}
interface Segment { id: string; name: string; matching: number; emailable: number }

const PLATFORM: Record<string, string> = { meta: 'Meta', google: 'Google Ads', meta_capi: 'Meta (server)' }
const KIND: Record<string, string> = { download: 'File downloaded', push: 'Sent', event: 'Purchase reported' }

export default function AudiencesPage() {
  const mayChange = useMayWrite('marketing:update')
  const mayConnect = useMayWrite('integrations:update')
  const [view, setView] = useState<View | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [segmentId, setSegmentId] = useState('')
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [form, setForm] = useState<Record<string, string>>({})
  const set = (k: string, v: string) => { setForm((f) => ({ ...f, [k]: v })); setNotice('') }

  const load = useCallback(async () => {
    try {
      const [v, s] = await Promise.all([api.get('/api/admin/audiences'), api.get('/api/admin/segments')])
      setView(v as View)
      const list = ((s as any)?.data ?? s) as Segment[]
      setSegments(list); setSegmentId((cur) => cur || list[0]?.id || '')
      setLoadError('')
    } catch (e) { setLoadError(errorText(e, "Couldn't load audiences")) }
  }, [])
  useEffect(() => { void load() }, [load])

  const seg = segments.find((s) => s.id === segmentId)

  const download = async (format: 'meta' | 'google') => {
    if (!seg) return
    setError(''); setNotice(''); setBusy(`dl-${format}`)
    try {
      const res = await api.raw(`/api/admin/audiences/segments/${seg.id}/export?format=${format}`)
      if (!res.ok) { let m = ''; try { m = (await res.json())?.error } catch { /* not JSON */ } throw new Error(m || `HTTP ${res.status}`) }
      const left = (() => { try { return JSON.parse(res.headers.get('X-Audience-Left-Out') || '{}') } catch { return {} } })()
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url; a.download = `${seg.name}-${format}-audience.csv`.replace(/[^\w.-]+/g, '-')
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setNotice(`The ${format === 'meta' ? 'Meta' : 'Google'} file has ${res.headers.get('X-Audience-People') ?? '?'} people${left.unsubscribed ? `; ${left.unsubscribed} who unsubscribed were left out` : ''}${left.unmatchable ? `; ${left.unmatchable} with no usable email or phone were left out` : ''}.`)
      await load()
    } catch (e) { setError(errorText(e, "Couldn't make the audience file")) } finally { setBusy('') }
  }

  const push = async (platform: 'meta' | 'google') => {
    if (!seg) return
    setError(''); setNotice(''); setBusy(`push-${platform}`)
    try {
      const r = (await api.post(`/api/admin/audiences/segments/${seg.id}/push`, { platform })) as { name: string; sent: number }
      setNotice(`Sent ${r.sent} people to ${platform === 'meta' ? 'Meta' : 'Google Ads'} as “${r.name}”. It can take a few hours to fill.`)
      await load()
    } catch (e) { setError(errorText(e, `Couldn't send the audience to ${platform === 'meta' ? 'Meta' : 'Google Ads'}`)); await load() } finally { setBusy('') }
  }

  const save = async (patch: Record<string, unknown>, label: string) => {
    setError(''); setNotice(''); setBusy('save')
    try {
      const body: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(patch)) body[k] = typeof v === 'string' && v.trim() === '' ? undefined : v
      await api.put('/api/admin/audiences/settings', body)
      setForm({}); await load(); setNotice(`${label} saved.`)
    } catch (e) { setError(errorText(e, `Couldn't save ${label.toLowerCase()}`)) } finally { setBusy('') }
  }

  const field = 'input mt-1 w-full'
  const shown = (k: string, fallback: string | null) => form[k] ?? fallback ?? ''
  const Saved = ({ on }: { on: boolean }) => (on ? <span className="ml-2 text-xs text-green-700 dark:text-green-400">Saved — leave empty to keep it</span> : null)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2"><Megaphone className="h-6 w-6" aria-hidden="true" />Audiences</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">Show your ads to the customers in a segment, and tell Meta and Google when someone buys. Customers are sent as scrambled codes (hashes), never as readable details, and anyone who unsubscribed from your emails is left out.</p>
      </div>
      {loadError ? <PageError message={`${loadError} — refresh to try again.`} /> : !view ? <p className="text-gray-500 dark:text-slate-400">Loading…</p> : (
        <>
          {error && <PageError message={error} />}
          {notice && <p role="status" className="text-sm text-green-700 dark:text-green-400">{notice}</p>}

          <section className="card p-4 sm:p-6 space-y-3" aria-label="Send a segment">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Send a segment</h2>
            {!segments.length ? <p className="text-sm text-gray-600 dark:text-slate-400">Save a segment first (Segments), then come back to send it.</p> : (
              <>
                <label className="block max-w-md text-sm text-gray-700 dark:text-slate-300">Segment
                  <select className={field} value={segmentId} onChange={(e) => { setSegmentId(e.target.value); setNotice('') }}>
                    {segments.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.matching} {s.matching === 1 ? 'customer' : 'customers'}</option>)}
                  </select></label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" disabled={!mayChange || !!busy} onClick={() => void download('meta')}>Download for Meta</button>
                  <button type="button" className="btn-secondary" disabled={!mayChange || !!busy} onClick={() => void download('google')}>Download for Google Ads</button>
                  <button type="button" className="btn-primary" disabled={!mayChange || !!busy || !view.meta.canPush} onClick={() => void push('meta')}>Send to Meta</button>
                  <button type="button" className="btn-primary" disabled={!mayChange || !!busy || !view.google.canPush} onClick={() => void push('google')}>Send to Google Ads</button>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  The downloads are files you upload yourself: in Meta, Audiences › Create › Custom audience › Customer list; in Google Ads, Tools › Audience manager › Customer lists.
                  {!view.meta.canPush && ' “Send to Meta” turns on once you connect your ad account below.'}
                  {!view.google.canPush && ' “Send to Google Ads” turns on once you connect Google Ads below.'} Each send makes a new audience on the platform; remove old ones there.
                </p>
              </>
            )}
          </section>

          <section className="card p-4 sm:p-6 space-y-3" aria-label="Purchase tags">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Tell Meta and Google about purchases</h2>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
              <input type="checkbox" checked={view.purchaseEventsOn} disabled={!mayConnect || busy === 'save'} onChange={(e) => void save({ purchaseEventsOn: e.target.checked }, 'Purchase tags')} />
              Report each paid order from the order-received page
            </label>
            <p className="text-sm text-gray-600 dark:text-slate-400">
              Google: {view.google.tagManagerId ? <>your Tag Manager container <strong>{view.google.tagManagerId}</strong> receives a <code>purchase</code> event with the order, its value and items. In the container, add a trigger on that custom event and attach your Google Ads conversion or GA4 purchase tag to it.</> : <>add your Tag Manager container id in Website settings; the page then sends a <code>purchase</code> event your container can use.</>}
            </p>
            <p className="text-sm text-gray-600 dark:text-slate-400">
              Meta: {view.meta.pixelId ? <>your pixel <strong>{view.meta.pixelId}</strong> (from Website settings) records a Purchase on the page.</> : <>add your Meta pixel id in Website settings; the page then records a Purchase.</>}
            </p>
            <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100 pt-2">Meta Conversions API (from our server)</h3>
            <p className="text-sm text-gray-600 dark:text-slate-400">Meta also hears about the purchase from us, so it still counts when a shopper’s browser blocks the pixel. It is counted once, not twice.</p>
            <label className="block text-sm text-gray-700 dark:text-slate-300">Conversions API access token<Saved on={view.meta.capiTokenSet} />
              <input className={field} type="password" autoComplete="off" value={shown('metaCapiToken', '')} disabled={!mayConnect} onChange={(e) => set('metaCapiToken', e.target.value)} /></label>
            <label className="block max-w-xs text-sm text-gray-700 dark:text-slate-300">Test event code (optional, from Meta Events Manager › Test events)
              <input className={field} value={shown('metaTestEventCode', view.meta.testEventCode)} disabled={!mayConnect} onChange={(e) => set('metaTestEventCode', e.target.value)} /></label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
              <input type="checkbox" checked={view.meta.capiOn} disabled={!mayConnect || busy === 'save'} onChange={(e) => void save({ metaCapiOn: e.target.checked, metaCapiToken: form.metaCapiToken, metaTestEventCode: form.metaTestEventCode }, 'Conversions API')} />
              Send purchases to the Conversions API
            </label>
            {mayConnect && <button type="button" className="btn-secondary" disabled={busy === 'save'} onClick={() => void save({ metaCapiToken: form.metaCapiToken, metaTestEventCode: form.metaTestEventCode ?? view.meta.testEventCode }, 'Conversions API details')}>Save Conversions API details</button>}
          </section>

          <section className="card p-4 sm:p-6 space-y-3" aria-label="Connect Meta">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Connect Meta (send audiences straight to your ad account)</h2>
            <p className="text-sm text-gray-600 dark:text-slate-400">Needs an access token that can manage ads on the account — a System User token with the <code>ads_management</code> permission. Without it, use the file download above.</p>
            <label className="block max-w-xs text-sm text-gray-700 dark:text-slate-300">Ad account id
              <input className={field} value={shown('metaAdAccountId', view.meta.adAccountId)} disabled={!mayConnect} onChange={(e) => set('metaAdAccountId', e.target.value)} /></label>
            <label className="block text-sm text-gray-700 dark:text-slate-300">Access token<Saved on={view.meta.accessTokenSet} />
              <input className={field} type="password" autoComplete="off" value={shown('metaAccessToken', '')} disabled={!mayConnect} onChange={(e) => set('metaAccessToken', e.target.value)} /></label>
            {mayConnect && <button type="button" className="btn-secondary" disabled={busy === 'save'} onClick={() => void save({ metaAdAccountId: shown('metaAdAccountId', view.meta.adAccountId), metaAccessToken: form.metaAccessToken }, 'Meta connection')}>Save Meta connection</button>}
          </section>

          <section className="card p-4 sm:p-6 space-y-3" aria-label="Connect Google Ads">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Connect Google Ads (send audiences straight to your account)</h2>
            <p className="text-sm text-gray-600 dark:text-slate-400">Google only lets an account upload customer lists through its API with a developer token that Google has approved (apply in your Google Ads manager account › API Center), plus an OAuth client and a refresh token for someone who manages the account. Without these, use the file download above.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-gray-700 dark:text-slate-300">Customer id (10 digits)
                <input className={field} value={shown('googleCustomerId', view.google.customerId)} disabled={!mayConnect} onChange={(e) => set('googleCustomerId', e.target.value)} /></label>
              <label className="block text-sm text-gray-700 dark:text-slate-300">Manager account id (if you use one)
                <input className={field} value={shown('googleLoginCustomerId', view.google.loginCustomerId)} disabled={!mayConnect} onChange={(e) => set('googleLoginCustomerId', e.target.value)} /></label>
              <label className="block text-sm text-gray-700 dark:text-slate-300">Developer token<Saved on={view.google.developerTokenSet} />
                <input className={field} type="password" autoComplete="off" value={shown('googleDeveloperToken', '')} disabled={!mayConnect} onChange={(e) => set('googleDeveloperToken', e.target.value)} /></label>
              <label className="block text-sm text-gray-700 dark:text-slate-300">OAuth client id
                <input className={field} value={shown('googleClientId', view.google.clientId)} disabled={!mayConnect} onChange={(e) => set('googleClientId', e.target.value)} /></label>
              <label className="block text-sm text-gray-700 dark:text-slate-300">OAuth client secret<Saved on={view.google.clientSecretSet} />
                <input className={field} type="password" autoComplete="off" value={shown('googleClientSecret', '')} disabled={!mayConnect} onChange={(e) => set('googleClientSecret', e.target.value)} /></label>
              <label className="block text-sm text-gray-700 dark:text-slate-300">Refresh token<Saved on={view.google.refreshTokenSet} />
                <input className={field} type="password" autoComplete="off" value={shown('googleRefreshToken', '')} disabled={!mayConnect} onChange={(e) => set('googleRefreshToken', e.target.value)} /></label>
            </div>
            {mayConnect && <button type="button" className="btn-secondary" disabled={busy === 'save'} onClick={() => void save({
              googleCustomerId: shown('googleCustomerId', view.google.customerId), googleLoginCustomerId: shown('googleLoginCustomerId', view.google.loginCustomerId), googleClientId: shown('googleClientId', view.google.clientId),
              googleDeveloperToken: form.googleDeveloperToken, googleClientSecret: form.googleClientSecret, googleRefreshToken: form.googleRefreshToken,
            }, 'Google Ads connection')}>Save Google Ads connection</button>}
          </section>

          <section className="card p-4 sm:p-6 space-y-2" aria-label="What this does not include">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Not included</h2>
            <p className="text-sm text-gray-600 dark:text-slate-400">Shopify Audiences matches your customers against purchase data pooled from all Shopify stores. That pool belongs to Shopify, so it cannot be offered here. What you get instead is your own customers, by what they bought and spent.</p>
          </section>

          <section className="card p-4 sm:p-6 space-y-2" aria-label="Recent activity">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Recent activity</h2>
            {!view.log.length ? <p className="text-sm text-gray-600 dark:text-slate-400">Nothing sent yet.</p> : (
              <ul className="divide-y divide-gray-100 dark:divide-slate-800 text-sm">
                {view.log.map((l) => (
                  <li key={l.id} className="py-2 flex flex-wrap justify-between gap-2">
                    <span className="text-gray-800 dark:text-slate-200">{PLATFORM[l.platform] ?? l.platform} — {KIND[l.kind] ?? l.kind}{l.people ? `, ${l.people} ${l.people === 1 ? 'person' : 'people'}` : ''}{l.detail ? ` — ${l.detail}` : ''}</span>
                    <span className={l.status === 'ok' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>{l.status === 'ok' ? 'Done' : 'Failed'} · {whenDateTime(l.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
