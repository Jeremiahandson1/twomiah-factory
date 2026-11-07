// The salon's own client app (salon parity row 25; salon_client_app, not ready; server crm/salon/clientApp.ts).
//   ClientAppSettings — the owner's card in Settings › The Book: what the app is, and the switch for the directory listing (company:update).
//   ClientAppInstall  — in the client portal: the portal made installable in the salon's name (its manifest and service worker), and an
//                       "Add to your home screen" offer when the phone's browser offers to install it.
import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useMayWrite } from '../../../shared'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-sm text-gray-600 dark:text-slate-300'

export function ClientAppSettings() {
  const toast = useToast()
  const mayEdit = useMayWrite('company:update')
  const [listed, setListed] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { api.get('/api/client-app-settings').then((r: any) => setListed(!!r?.directoryListing)).catch(() => setListed(null)) }, [])
  const flip = async (next: boolean) => {
    if (!mayEdit) return
    setSaving(true)
    try { const r: any = await api.put('/api/client-app-settings', { directoryListing: next }); setListed(!!r?.directoryListing); toast.success(next ? 'Your salon is listed in the directory' : 'Your salon is no longer listed') }
    catch (e: any) { toast.error(e?.message || 'The setting could not be saved.') } finally { setSaving(false) }
  }
  return (
    <section className={box} data-testid="client-app-settings">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-slate-100"><Smartphone className="h-5 w-5" /> Your client app</h2>
      <p className={hint}>
        Your clients can put their portal on their phone&rsquo;s home screen as an app in your salon&rsquo;s name and colour — to book, rebook, see their
        visits, gift cards and membership. They are offered it when they open the link you send them. Twomiah takes no commission on your clients.
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
        <input type="checkbox" checked={!!listed} disabled={listed === null || saving || !mayEdit} onChange={(e) => flip(e.target.checked)} />
        List my salon in the directory (name, address, phone, booking page and services as your menu shows them online)
      </label>
    </section>
  )
}

/** In the portal: the app's manifest and service worker, when the salon has the app; and the browser's own install offer. */
export function ClientAppInstall({ token }: { token: string }) {
  const [offer, setOffer] = useState<any>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    fetch('/api/client-app/manifest.webmanifest?t=' + encodeURIComponent(token)).then((r) => {
      if (!alive || !r.ok) return
      setOn(true)
      const link = document.createElement('link')
      link.rel = 'manifest'; link.href = '/api/client-app/manifest.webmanifest?t=' + encodeURIComponent(token); link.setAttribute('data-client-app', '1')
      document.head.appendChild(link)
      r.json().then((m: any) => {
        if (!alive || !m?.theme_color) return
        const meta = document.createElement('meta'); meta.name = 'theme-color'; meta.content = m.theme_color; meta.setAttribute('data-client-app', '1')
        document.head.appendChild(meta)
      }).catch(() => {})
      try { (navigator as any).serviceWorker?.register('/api/client-app/sw.js', { scope: '/portal/' })?.catch?.(() => {}) } catch { /* no service workers here */ }
    }).catch(() => {})
    const onPrompt = (e: any) => { e.preventDefault(); setOffer(e) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => { alive = false; window.removeEventListener('beforeinstallprompt', onPrompt); document.querySelectorAll('[data-client-app="1"]').forEach((n) => n.remove()) }
  }, [token])
  if (!on || !offer) return null
  return (
    <div role="region" aria-label="Install the app" className="mx-auto mt-3 flex max-w-3xl items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900">
      <span className="text-gray-800 dark:text-slate-100">Add us to your home screen to book and see your visits in one tap.</span>
      <button type="button" className="rounded-lg bg-teal-700 px-3 py-1.5 font-medium text-white" onClick={async () => { try { await offer.prompt() } finally { setOffer(null) } }}>Add to home screen</button>
    </div>
  )
}
