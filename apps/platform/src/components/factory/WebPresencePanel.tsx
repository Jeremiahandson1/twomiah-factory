import { useEffect, useState } from 'react'
import { supabase, API_URL as API } from '../../supabase'
import { Globe, RefreshCw, KeyRound, XCircle, Trash2 } from 'lucide-react'

// A $19 Web presence customer's site, for staff (11/06). The site lives on its own Netlify site; the Factory's staff routes
// (api routes/factory/webPresence.ts) are the only way staff reach it: a sign-in link to its editor, set it up again, end it with
// the paid period, or take it down now. What the owner sells and who bought is theirs, in their editor — not shown here.

type Site = {
  status: 'creating' | 'live' | 'failed' | 'canceling' | 'upgrading' | 'removed'
  origin: string | null; custom_domain: string | null; ssl_ok: boolean; cancel_at: string | null; netlify_site_name: string | null
}
type Props = { tenantId: string; showToast: (msg: string, type?: 'success' | 'error') => void; onChanged: () => void }

const WORDS: Record<Site['status'], string> = {
  creating: 'Being set up', live: 'Live', failed: 'Set-up failed — press Retry', canceling: 'Ends with the paid period',
  upgrading: 'Moving to the full plan', removed: 'Taken down',
}

async function call(method: string, path: string): Promise<{ ok: boolean; data: any }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { ok: false, data: { error: 'Not signed in' } }
  const res = await fetch(API + '/api/v1/factory/web-presence/' + path, { method, headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' } })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

export default function WebPresencePanel({ tenantId, showToast, onChanged }: Props) {
  const [site, setSite] = useState<Site | null>(null)
  const [state, setState] = useState<'loading' | 'none' | 'ok' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')

  const load = async () => {
    const r = await call('GET', tenantId)
    if (r.ok && r.data.site) { setSite(r.data.site); setState('ok') } else setState(r.data?.error === 'Not found' ? 'none' : 'error')
  }
  useEffect(() => { load() }, [tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (path: string, ok: (d: any) => string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    const r = await call('POST', tenantId + '/' + path)
    setBusy(false)
    if (!r.ok) { showToast(r.data?.error || 'That did not work', 'error'); return }
    showToast(ok(r.data)); await load(); onChanged()
  }
  const signin = async () => {
    setBusy(true)
    const r = await call('POST', tenantId + '/signin-link')
    setBusy(false)
    if (!r.ok || !r.data.link) { showToast(r.data?.error || 'Could not make a link', 'error'); return }
    setLink(r.data.link)
  }

  const address = site ? (site.custom_domain && site.ssl_ok ? 'https://' + site.custom_domain : site.origin) : null
  const BTN = 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50'
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h2 className="text-white font-semibold mb-1 flex items-center gap-2"><Globe size={18} /> Web presence site ($19 plan)</h2>
      <p className="text-gray-400 text-sm mb-4">A one-page site on its own Netlify site, with its editor built in. The owner signs in with an emailed link; staff reach it only from here.</p>
      {state === 'loading' && <p className="text-gray-400 text-sm">Loading…</p>}
      {state === 'error' && <p className="text-red-400 text-sm">Could not load the site.</p>}
      {state === 'none' && (
        <div className="space-y-3">
          <p className="text-gray-300 text-sm">No site has been set up for this customer yet.</p>
          <button disabled={busy} onClick={() => act('retry', (d) => 'Set-up ran: ' + d.status)} className={BTN + ' bg-blue-600 hover:bg-blue-500 text-white'}><RefreshCw size={14} /> Set the site up</button>
        </div>
      )}
      {state === 'ok' && site && (
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-400">Status</dt><dd className="text-white">{WORDS[site.status] || site.status}{site.cancel_at ? ' (' + new Date(site.cancel_at).toLocaleDateString() + ')' : ''}</dd>
            <dt className="text-gray-400">Address</dt><dd className="text-white break-all">{address ? <a className="underline" href={address} target="_blank" rel="noopener noreferrer">{address}</a> : '—'}</dd>
            <dt className="text-gray-400">Own domain</dt><dd className="text-white">{site.custom_domain ? site.custom_domain + (site.ssl_ok ? '' : ' (waiting for its certificate)') : 'None'}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            {site.status === 'live' && <button disabled={busy} onClick={signin} className={BTN + ' bg-gray-800 hover:bg-gray-700 text-white'}><KeyRound size={14} /> Sign-in link to their editor</button>}
            {(site.status === 'failed' || site.status === 'creating') && <button disabled={busy} onClick={() => act('retry', (d) => 'Set-up ran: ' + d.status)} className={BTN + ' bg-blue-600 hover:bg-blue-500 text-white'}><RefreshCw size={14} /> Retry set-up</button>}
            {site.status === 'live' && <button disabled={busy} onClick={() => act('cancel', (d) => 'Ends on ' + new Date(d.cancelAt).toLocaleDateString(), 'End this customer\'s $19 plan at the end of the period they have paid for? The site comes down then.')} className={BTN + ' bg-gray-800 hover:bg-gray-700 text-white'}><XCircle size={14} /> Cancel at period end</button>}
            {site.status !== 'removed' && <button disabled={busy} onClick={() => act('remove', () => 'Site taken down', 'Take this site down NOW? Visitors will see nothing. This does not end their Stripe subscription — do that under billing.')} className={BTN + ' bg-red-900/60 hover:bg-red-800 text-red-100'}><Trash2 size={14} /> Take down now</button>}
          </div>
          {link && (
            <div className="bg-gray-800 rounded-lg p-3 text-sm">
              <p className="text-gray-300 mb-1">Works once, for 15 minutes. Open it yourself to get into their editor:</p>
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="w-full px-2 py-1 bg-gray-900 border border-gray-700 rounded text-white text-xs" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
