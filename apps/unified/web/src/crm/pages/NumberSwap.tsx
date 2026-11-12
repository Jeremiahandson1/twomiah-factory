// THE WEBSITE NUMBER SWAP on the Call Tracking page (CallRail's dynamic number insertion; server crm/comms/numberSwap.ts):
//   · WebsiteSwapCell — on a tracking number: which website visitors are shown it in place of the business's own number, and
//     whether it is one of a visitor pool (handed to one visitor at a time, so a call says which visit, search words and page);
//   · NumberSwapEmbed — the line to paste on a website Twomiah did not build (the Twomiah site has it already).
// The sources match the server's list (crm/comms/numberSwapRules.ts SWAP_SOURCES).
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { errorText, useToast } from '../../shared'

export const SWAP_SOURCES: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'Every visitor' },
  { id: 'google_ads', label: 'Google Ads' },
  { id: 'google_organic', label: 'Google search (not ads)' },
  { id: 'google_business', label: 'Google Business Profile' },
  { id: 'bing_ads', label: 'Microsoft Ads' },
  { id: 'bing_organic', label: 'Bing search (not ads)' },
  { id: 'other_search', label: 'Other search engines' },
  { id: 'facebook', label: 'Facebook and Instagram' },
  { id: 'yelp', label: 'Yelp' },
  { id: 'email', label: 'Email' },
  { id: 'referral', label: 'Other websites' },
  { id: 'direct', label: 'Direct (typed in, bookmarks)' },
]

export function WebsiteSwapCell({ id, swapSource, inPool, mayChange, onSaved }: { id: string; swapSource: string | null; inPool: boolean; mayChange: boolean; onSaved: () => void }) {
  const toast = useToast()
  const isUtm = !!swapSource && swapSource.startsWith('utm:')
  const [choice, setChoice] = useState(isUtm ? 'utm' : swapSource || '')
  const [utm, setUtm] = useState(isUtm ? swapSource!.slice(4) : '')
  const [pool, setPool] = useState(inPool)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setChoice(isUtm ? 'utm' : swapSource || ''); setUtm(isUtm ? swapSource!.slice(4) : ''); setPool(inPool) }, [swapSource, inPool]) // eslint-disable-line react-hooks/exhaustive-deps

  const label = !swapSource ? 'Not on the website' : isUtm ? `utm_source = ${swapSource.slice(4)}` : SWAP_SOURCES.find((s) => s.id === swapSource)?.label ?? swapSource
  if (!mayChange) return <span className="text-sm text-gray-700 dark:text-slate-300">{label}{swapSource && inPool ? ' · visitor pool' : ''}</span>

  const next = choice === 'utm' ? (utm.trim() ? `utm:${utm.trim().toLowerCase()}` : null) : choice || null
  const dirty = next !== (swapSource || null) || (!!next && pool !== inPool)
  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/api/calltracking/numbers/${id}`, { swapSource: next, inPool: !!next && pool })
      toast.success(next ? 'Website number saved' : 'Taken off the website')
      onSaved()
    } catch (e) { toast.error(errorText(e, "Couldn't save the website number")) } finally { setSaving(false) }
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <select aria-label="Show on my website to" className="input py-1 text-sm" value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">Not on the website</option>
        {SWAP_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        <option value="utm">A campaign tag (utm_source)…</option>
      </select>
      {choice === 'utm' && <input aria-label="utm_source" className="input py-1 text-sm" placeholder="e.g. mailer" value={utm} onChange={(e) => setUtm(e.target.value.replace(/[^A-Za-z0-9._-]/g, ''))} />}
      {choice && (
        <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-slate-300" title="Each visitor gets their own number from the pool, so a call shows the exact visit: search words, campaign and landing page">
          <input type="checkbox" checked={pool} onChange={(e) => setPool(e.target.checked)} /> Part of a visitor pool
        </label>
      )}
      {dirty && <button type="button" onClick={save} disabled={saving} className="btn btn-primary self-start px-2 py-1 text-xs">{saving ? 'Saving…' : 'Save'}</button>}
    </div>
  )
}

export function NumberSwapEmbed() {
  const [snippet, setSnippet] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { api.get('/api/calltracking/settings').then((r: any) => setSnippet(r?.numberSwapScript || '')).catch(() => setSnippet('')) }, [])
  if (!snippet) return null
  const copy = async () => { try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* the box can be selected by hand */ } }
  return (
    <div className="card p-5 space-y-2">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Show tracking numbers on your website</h3>
      <p className="text-sm text-gray-600 dark:text-slate-400">Your Twomiah website swaps in your tracking numbers by itself. For another website, paste this line into its pages, just before <code>&lt;/body&gt;</code>. Visitors then see the number set for where they came from (above, on each number), and your own number everywhere else.</p>
      <textarea readOnly aria-label="Website number swap script" className="input font-mono text-xs" rows={2} value={snippet} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={copy} className="btn btn-secondary text-xs px-3 py-1.5">{copied ? 'Copied' : 'Copy'}</button>
    </div>
  )
}

/**
 * The CALL WHISPER on a tracking number (CallRail's whisper message; server crm/comms/calltracking.ts voice): what the person
 * answering hears before the caller is put through, so they know where the call came from. The caller never hears it.
 */
export function WhisperCell({ id, whisper, name, mayChange, onSaved }: { id: string; whisper: string | null; name: string | null; mayChange: boolean; onSaved: () => void }) {
  const toast = useToast()
  const [text, setText] = useState(whisper || '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setText(whisper || '') }, [whisper])
  if (!mayChange) return <span className="text-sm text-gray-700 dark:text-slate-300">{whisper || 'None'}</span>
  const dirty = text.trim() !== (whisper || '')
  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/api/calltracking/numbers/${id}`, { whisper: text.trim() || null })
      toast.success(text.trim() ? 'Whisper saved' : 'Whisper removed')
      onSaved()
    } catch (e) { toast.error(errorText(e, "Couldn't save the whisper")) } finally { setSaving(false) }
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <input aria-label="What the person answering hears" className="input py-1 text-sm" maxLength={200} placeholder={`e.g. Call from ${name || 'Google Ads'}`} value={text} onChange={(e) => setText(e.target.value)} />
      {dirty && <button type="button" onClick={save} disabled={saving} className="btn btn-primary self-start px-2 py-1 text-xs">{saving ? 'Saving…' : 'Save'}</button>}
    </div>
  )
}
