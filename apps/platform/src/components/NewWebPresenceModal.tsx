import { useState } from 'react'
import { supabase, API_URL as API } from '../supabase'
import { X } from 'lucide-react'

// Staff set a $19 Web presence customer up — no signup for the customer (11/06). The Factory makes the same customer and site the
// signup does (api webPresence/staffCreate.ts), builds the site now, emails the owner a sign-in link, and Stripe emails them the
// $19/month invoice. Nothing here writes the database directly.

type Props = { onClose: () => void; onCreated: (tenantId: string) => void }
const INPUT = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500'

export default function NewWebPresenceModal({ onClose, onCreated }: Props) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', industry: '', city: '', state: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ tenantId: string; message: string; invoiceUrl?: string | null } | null>(null)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) { setBusy(false); setError('Not signed in'); return }
    const res = await fetch(API + '/api/v1/factory/web-presence/customers', {
      method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(data.error || (res.status === 404 ? 'The Web presence plan is switched off.' : 'That did not work'))
      if (data.tenantId) onCreated(data.tenantId)
      return
    }
    setDone({ tenantId: data.tenantId, message: data.message, invoiceUrl: data.invoiceUrl })
    onCreated(data.tenantId)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-white">New Web presence site ($19/month)</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-white transition-colors"><X size={20} /></button>
        </div>
        {done ? (
          <div className="space-y-4">
            <p className="text-gray-200 text-sm">{done.message}</p>
            {done.invoiceUrl && <p className="text-gray-400 text-xs break-all">Their invoice: <a className="underline" href={done.invoiceUrl} target="_blank" rel="noopener noreferrer">{done.invoiceUrl}</a></p>}
            <button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-2 text-sm font-medium">Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-gray-400 text-sm">For a customer who should not have to sign up. Their one-page site is built now and they are emailed a sign-in link; Stripe emails them the $19/month invoice.</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className="block text-xs text-gray-400 mb-1" htmlFor="wp-name">Business name</label><input id="wp-name" required minLength={2} value={form.name} onChange={set('name')} className={INPUT} /></div>
              <div className="col-span-2"><label className="block text-xs text-gray-400 mb-1" htmlFor="wp-email">Owner's email (sign-in link and invoice go here)</label><input id="wp-email" type="email" required value={form.email} onChange={set('email')} className={INPUT} /></div>
              <div><label className="block text-xs text-gray-400 mb-1" htmlFor="wp-phone">Phone</label><input id="wp-phone" type="tel" value={form.phone} onChange={set('phone')} className={INPUT} /></div>
              <div><label className="block text-xs text-gray-400 mb-1" htmlFor="wp-ind">What they do</label><input id="wp-ind" placeholder="e.g. roofing, salon, education" value={form.industry} onChange={set('industry')} className={INPUT} /></div>
              <div><label className="block text-xs text-gray-400 mb-1" htmlFor="wp-city">City</label><input id="wp-city" value={form.city} onChange={set('city')} className={INPUT} /></div>
              <div><label className="block text-xs text-gray-400 mb-1" htmlFor="wp-state">State</label><input id="wp-state" value={form.state} onChange={set('state')} className={INPUT} /></div>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white rounded-lg py-2 text-sm font-medium">Cancel</button>
              <button type="submit" disabled={busy} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50">{busy ? 'Setting up…' : 'Create and build'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
