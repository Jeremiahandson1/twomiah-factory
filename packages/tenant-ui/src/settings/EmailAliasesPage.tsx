import React, { useState, useEffect, useRef } from 'react'
import { useConfirm } from '../ui/ConfirmProvider'
import { api } from '../api/client'

// First-class settings page vendored into each tenant.
// Add / rename / remove / toggle routing mode for email aliases on the
// tenant's connected domain. Works standalone in Settings; can also be
// embedded by the onboarding wizard in Phase 3 final cut.
//
// No-domain state: renders a callout pointing to the Email Domain page.

interface Alias {
  id: string
  localPart: string
  routingMode: 'forward' | 'crm'
  forwardTo: string | null
  enabled: boolean
  /** A team member's address (the server sends these only where addresses can be a member's): */
  userId?: string | null
  deliversTo?: string | null
  member?: { id: string; name: string; active: boolean } | null
  fallback?: 'off' | 'removed' | null
}

/** The people an address can be given to; sent by the server only where it supports it. */
interface Member { id: string; name: string; email: string }
const OTHER = '__other__'

interface CompanyInfo {
  domain?: string | null
  email?: string | null
}

// Where each address stands on the domain — the Factory's answer (GET /api/email-aliases/status, which
// also sets the addresses up). Mail arrives only when the domain is active on Cloudflare, Email Routing
// is on, and the forward-to inbox has confirmed; the page names whichever is missing.
type AliasState = 'live' | 'confirm_destination' | 'waiting_for_domain' | 'waiting_for_nameservers' | 'off' | 'error'
interface StatusReport {
  state: 'live' | 'action_needed' | 'waiting_for_domain' | 'waiting_for_nameservers' | 'crm_needs_update' | 'error'
  domain: string | null
  nameservers?: string[]
  detail?: string
  aliases: Array<{ localPart: string; address: string | null; state: AliasState; destination?: string | null; detail?: string }>
}

// Each chip is a complete pair: ground + ink, in both themes.
const CHIP: Record<AliasState, { label: string; cls: string }> = {
  live: { label: 'Receiving mail', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' },
  confirm_destination: { label: 'Confirm the inbox', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' },
  waiting_for_domain: { label: 'Waiting for your domain', cls: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200' },
  waiting_for_nameservers: { label: 'Waiting for nameservers', cls: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200' },
  off: { label: 'Off', cls: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200' },
  error: { label: 'Not set up', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
}


// The bearer token is added by api.raw — the current one, refreshed when it has expired.
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' }
}

export function EmailAliasesPage(): React.ReactElement {
  const confirm = useConfirm()
  const [aliases, setAliases] = useState<Alias[]>([])
  const [company, setCompany] = useState<CompanyInfo>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [newAlias, setNewAlias] = useState({ localPart: '', routingMode: 'forward' as 'forward' | 'crm', forwardTo: '', userId: '' })
  const [members, setMembers] = useState<Member[] | null>(null)
  /** Once "Forward to" is picked by hand, typing the address no longer suggests a team member. */
  const chosenByHand = useRef(false)
  const [status, setStatus] = useState<StatusReport | null>(null)
  const [resent, setResent] = useState<string>('')

  useEffect(() => { load() }, [])

  // The status is the Factory's (and it reconciles Cloudflare on the way), so it loads after the list
  // and never holds the list up.
  async function loadStatus() {
    try {
      const res = await api.raw('/api/email-aliases/status', { headers: authHeaders() })
      if (res.ok) setStatus(await res.json())
    } catch { /* the rows simply show no state */ }
  }

  async function resendConfirmation(destination: string) {
    setError(''); setResent('')
    try {
      const res = await api.raw('/api/email-aliases/resend-confirmation', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ destination }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not send it again'); return }
      setResent(data.alreadyConfirmed ? destination + ' has already confirmed.' : 'Sent again to ' + destination + ' — check that inbox (and its spam folder).')
      loadStatus()
    } catch (err: any) { setError(err.message) }
  }

  async function load() {
    setLoading(true); setError('')
    try {
      const [aRes, cRes] = await Promise.all([
        api.raw('/api/email-aliases', { headers: authHeaders() }),
        api.raw('/api/company', { headers: authHeaders() }),
      ])
      if (!aRes.ok) throw new Error('Failed to load aliases: ' + aRes.status)
      const aData = await aRes.json()
      setAliases(aData.aliases || [])
      setMembers(Array.isArray(aData.members) ? aData.members : null)
      if (cRes.ok) {
        const cData = await cRes.json()
        setCompany({ domain: cData?.domain || cData?.company?.domain || null, email: cData?.email || cData?.company?.email || null })
        if (!newAlias.forwardTo && cData?.email) setNewAlias(prev => ({ ...prev, forwardTo: cData.email }))
      }
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
    loadStatus()
  }

  async function addAlias() {
    setError('')
    try {
      const res = await api.raw('/api/email-aliases', {
        method: 'POST', headers: authHeaders(),
        // A team member's address goes by their id; otherwise the typed inbox.
        body: JSON.stringify(newAlias.userId ? { localPart: newAlias.localPart, routingMode: 'forward', userId: newAlias.userId } : { localPart: newAlias.localPart, routingMode: newAlias.routingMode, forwardTo: newAlias.forwardTo }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Create failed'); return }
      setAliases(prev => [...prev, data.alias])
      setNewAlias({ localPart: '', routingMode: 'forward', forwardTo: company.email || '', userId: '' })
      chosenByHand.current = false
      setAdding(false)
      loadStatus()
    } catch (err: any) { setError(err.message) }
  }

  async function updateAlias(id: string, patch: Partial<Alias>) {
    setError('')
    try {
      const res = await api.raw('/api/email-aliases/' + id, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Update failed'); return }
      setAliases(prev => prev.map(a => a.id === id ? data.alias : a))
      loadStatus()
    } catch (err: any) { setError(err.message) }
  }

  async function deleteAlias(id: string) {
    if (!(await confirm('Delete this alias? Forwarding will stop immediately.', { title: 'Delete alias', confirmText: 'Delete it' }))) return
    setError('')
    try {
      const res = await api.raw('/api/email-aliases/' + id, { method: 'DELETE', headers: authHeaders() })
      if (!res.ok) { const data = await res.json().catch(() => ({})); setError(data.error || 'Delete failed'); return }
      setAliases(prev => prev.filter(a => a.id !== id))
      loadStatus()
    } catch (err: any) { setError(err.message) }
  }

  // The Factory knows the domain the moment it is attached, before the company record carries it.
  const domain = company.domain || status?.domain || null
  const stateOf = (localPart: string) => status?.aliases.find(x => x.localPart === localPart)

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Email Addresses</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">Create branded email addresses on your domain. Each one can forward to wherever you read email, or route replies into the CRM as conversation threads.</p>

      {/* Onboarding saves the addresses before there is a domain, so "connect a domain FIRST" beside a list of them
          read as a contradiction (E2E run 1, 10/14). Say what is true: they are kept, and receive mail once one is connected. */}
      {status?.state === 'waiting_for_nameservers' && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/50 rounded-md p-4 mb-6 text-yellow-900 dark:text-yellow-200">
          <div className="font-semibold mb-1">Waiting for {status.domain} to point at Cloudflare</div>
          <div className="text-sm">
            These addresses are set up by themselves as soon as the domain's nameservers are changed
            {status.nameservers?.length ? <> to <strong>{status.nameservers.join(' and ')}</strong></> : null}
            {' '}(see <strong>Settings → Email Domain</strong>). That usually takes under an hour once the change is made.
          </div>
        </div>
      )}
      {status?.state === 'action_needed' && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-md p-4 mb-6 text-sm text-amber-900 dark:text-amber-200">
          <strong>Almost there.</strong> Cloudflare forwards an address only after the inbox it forwards to confirms. Open the confirmation email it sent (subject mentions Cloudflare Email Routing) and click <strong>Verify email address</strong>.
        </div>
      )}
      {status?.state === 'live' && aliases.length > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-md p-3 mb-6 text-sm text-green-800 dark:text-green-200">Every address is receiving mail.</div>
      )}
      {(status?.state === 'crm_needs_update' || status?.state === 'error') && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-md p-4 mb-6 text-sm text-red-800 dark:text-red-200">
          <strong>These addresses are not receiving mail yet.</strong> {status.detail || 'The setup could not be checked.'} If it does not clear within the hour, contact support.
        </div>
      )}
      {resent && <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/50 rounded-md p-3 mb-4 text-sm text-blue-800 dark:text-blue-200">{resent}</div>}

      {!domain && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/50 rounded-md p-4 mb-6">
          <div className="font-semibold text-yellow-900 dark:text-yellow-200 mb-1">{aliases.length ? 'Waiting for your domain' : 'Connect a domain first'}</div>
          <div className="text-sm text-yellow-800 dark:text-yellow-200">
            {aliases.length
              ? <>These addresses are saved. They start receiving mail once your domain is connected in <strong>Settings → Email Domain</strong>.</>
              : <>Email addresses need a domain. Go to <strong>Settings → Email Domain</strong> to connect one.</>}
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-md p-3 mb-4 text-sm text-red-700 dark:text-red-200">{error}</div>}

      {loading && <div className="text-sm text-gray-500 dark:text-slate-400">Loading…</div>}

      {!loading && (
        <div className="space-y-3">
          {aliases.length === 0 && !adding && (
            <div className="text-sm text-gray-500 dark:text-slate-400 italic py-6 text-center border border-dashed border-gray-300 rounded-md">No email addresses yet.</div>
          )}

          {aliases.map(a => (
            <AliasRow key={a.id} alias={a} domain={domain} members={members} state={stateOf(a.localPart)} onResend={resendConfirmation} onUpdate={patch => updateAlias(a.id, patch)} onDelete={() => deleteAlias(a.id)} />
          ))}

          {adding && domain && (
            <div className="border border-gray-300 rounded-md p-4 bg-gray-50 dark:bg-slate-800 dark:text-slate-100">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-1">Address</label>
                  <div className="flex items-center">
                    <input type="text" placeholder="support" value={newAlias.localPart} onChange={e => {
                      const localPart = e.target.value.trim().toLowerCase()
                      // billy@ suggests Billy (first name, or first.last), until a choice is made by hand.
                      const named = members?.find(m => { const [f, ...r] = m.name.toLowerCase().split(/\s+/); return localPart === f || localPart === [f, ...r].join('.') })
                      setNewAlias(v => ({ ...v, localPart, ...(chosenByHand.current ? {} : { userId: named?.id ?? '' }) }))
                    }} className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md text-sm" />
                    <span className="px-3 py-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-md text-sm text-gray-600 dark:text-slate-300 dark:bg-slate-800">@{domain}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-1">Mode</label>
                  <select value={newAlias.routingMode} onChange={e => setNewAlias(v => ({ ...v, routingMode: e.target.value as any }))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                    <option value="forward">Forward to external email</option>
                    <option value="crm">Route into CRM</option>
                  </select>
                </div>
              </div>
              {newAlias.routingMode === 'forward' && (
                <div className="mb-3">
                  <label htmlFor="alias-forward-to" className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-1">Forward to</label>
                  {members && members.length > 0 && (
                    <select id="alias-forward-to" value={newAlias.userId || OTHER} onChange={e => { chosenByHand.current = true; setNewAlias(v => ({ ...v, userId: e.target.value === OTHER ? '' : e.target.value })) }} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-2">
                      {members.map(m => <option key={m.id} value={m.id}>{m.name} — {m.email}</option>)}
                      <option value={OTHER}>Another email…</option>
                    </select>
                  )}
                  {newAlias.userId
                    ? <p className="text-xs text-gray-600 dark:text-slate-300">Goes to the email they sign in with. If they are switched off, it goes to the owner instead.</p>
                    : <input type="email" aria-label="Forward to email" placeholder="you@yourbusiness.com" value={newAlias.forwardTo} onChange={e => setNewAlias(v => ({ ...v, forwardTo: e.target.value.trim() }))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={addAlias} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-md text-sm font-semibold">Create</button>
                <button onClick={() => setAdding(false)} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-md text-sm dark:text-slate-200 dark:bg-slate-700">Cancel</button>
              </div>
            </div>
          )}

          {!adding && domain && (
            <button onClick={() => setAdding(true)} className="w-full py-3 border border-dashed border-gray-300 text-gray-600 rounded-md text-sm hover:bg-gray-50 dark:hover:bg-slate-800 dark:text-slate-300">+ Add email address</button>
          )}
        </div>
      )}
    </div>
  )
}

function AliasRow({ alias, domain, members, state, onResend, onUpdate, onDelete }: {
  alias: Alias; domain: string | null | undefined
  members: Member[] | null
  state?: StatusReport['aliases'][number]
  onResend: (destination: string) => void
  onUpdate: (patch: Partial<Alias>) => void; onDelete: () => void
}) {
  const [editingForward, setEditingForward] = useState(false)
  const [forwardDraft, setForwardDraft] = useState(alias.forwardTo || '')
  const [choice, setChoice] = useState<string>(alias.userId && alias.member?.active ? alias.userId : OTHER)
  const save = () => {
    onUpdate(choice !== OTHER ? { userId: choice } : { forwardTo: forwardDraft })
    setEditingForward(false)
  }
  // Where the mail goes, in words: the member's name and inbox, the owner's while they are switched off, or the typed inbox.
  const where = alias.member?.active
    ? <>Forwards to <strong>{alias.member.name}</strong> ({alias.deliversTo})</>
    : alias.fallback
      ? <>Forwards to the owner (<strong>{alias.deliversTo || 'no owner email'}</strong>)</>
      : <>Forwards to <strong>{alias.deliversTo ?? alias.forwardTo ?? '—'}</strong></>

  return (
    // On a phone the controls go under the address: beside it they squeezed the address to "billy…" and its words to one
    // per line (screenshot, 10/30).
    <div className="border border-gray-200 rounded-md p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-sm break-all">{alias.localPart}{domain ? '@' + domain : ''}</span>
          {state && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CHIP[state.state].cls}`}>{CHIP[state.state].label}</span>}
        </div>
        {state?.detail && (
          <div className="text-xs mt-0.5 text-gray-600 dark:text-slate-300">
            {state.detail}
            {state.state === 'confirm_destination' && alias.routingMode === 'forward' && state.destination && (
              <>{' '}<button onClick={() => onResend(state.destination!)} className="underline font-semibold text-orange-700 dark:text-orange-200">Send it again</button></>
            )}
          </div>
        )}
        {alias.routingMode === 'forward' && alias.fallback && (
          <div className="text-xs mt-0.5 text-amber-900 dark:text-amber-200">
            {alias.fallback === 'off'
              ? <>{alias.member?.name || 'Its team member'} is switched off, so this address goes to the owner. Give it to someone else, or delete it.</>
              : <>Its team member was removed, so this address goes to the owner. Give it to someone else, or delete it.</>}
          </div>
        )}
        <div className="text-xs text-gray-500 dark:text-slate-400">
          {alias.routingMode === 'forward'
            ? (editingForward
                ? <span className="inline-flex flex-wrap items-center gap-2">
                    {members && members.length > 0 && (
                      <select aria-label={'Forward ' + alias.localPart + ' to'} value={choice} onChange={e => setChoice(e.target.value)} className="px-2 py-0.5 border border-gray-300 rounded text-xs">
                        {members.map(m => <option key={m.id} value={m.id}>{m.name} — {m.email}</option>)}
                        <option value={OTHER}>Another email…</option>
                      </select>
                    )}
                    {choice === OTHER && <input type="email" aria-label={'Forward ' + alias.localPart + ' to email'} value={forwardDraft} onChange={e => setForwardDraft(e.target.value)} className="px-2 py-0.5 border border-gray-300 rounded text-xs" />}
                    <button onClick={save} className="text-xs text-orange-600 dark:text-orange-200">Save</button>
                    <button onClick={() => { setForwardDraft(alias.forwardTo || ''); setChoice(alias.userId && alias.member?.active ? alias.userId : OTHER); setEditingForward(false) }} className="text-xs text-gray-500 dark:text-slate-400">Cancel</button>
                  </span>
                : <>{where}{' '}<button onClick={() => setEditingForward(true)} className="underline text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200">change</button></>)
            : <>Routes into CRM conversations</>}
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <select aria-label={'How ' + alias.localPart + ' is handled'} value={alias.routingMode} onChange={e => onUpdate({ routingMode: e.target.value as any })} className="px-2 py-1 border border-gray-300 rounded text-xs">
          <option value="forward">Forward</option>
          <option value="crm">CRM</option>
        </select>
        <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-slate-300">
          <input type="checkbox" checked={alias.enabled} onChange={e => onUpdate({ enabled: e.target.checked })} />
          Enabled
        </label>
        <button onClick={onDelete} className="text-xs text-red-600 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200">Delete</button>
      </div>
    </div>
  )
}
