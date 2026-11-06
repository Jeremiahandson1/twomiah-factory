// Billing contacts (care_billing_contacts, parity row 23): who pays each client's invoices — the client, one of their family
// members or someone else — and up to five addresses that get every invoice, reminder and payment notice. Several clients
// can be given the same contact at once (a son who pays for both parents, a trust officer for many).
//   GET /api/care-billing-contacts/clients, GET|PUT /api/care-billing-contacts/clients/:id, POST /api/care-billing-contacts/bulk
//   (server/crm/homecare/billing/billingContactRoutes.ts)
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast } from '../../../../shared'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { useMay } from '../lib/useMay'

type Kind = 'client' | 'family' | 'other'
interface Row {
  clientId: string; firstName: string; lastName: string; clientEmail: string | null; kind: Kind | null
  familyMemberId: string | null; contactName: string | null; extraEmails: string[]; sendsTo: string[]; problem: string | null
}
interface Member { id: string; name: string; relationship: string | null; email: string | null }
interface Draft { kind: Kind | ''; familyMemberId: string; name: string; emails: string }

const MAX = 5
const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const KIND_WORDS: Record<Kind, string> = { client: 'The client', family: 'A family member', other: 'Someone else' }
const splitEmails = (s: string) => s.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean)

/** The fields of one billing contact, for one client (family members offered) or for many (not). */
function ContactFields({ draft, setDraft, members, bulk, disabled }: { draft: Draft; setDraft: (d: Draft) => void; members?: Member[]; bulk?: boolean; disabled?: boolean }) {
  const kinds: Kind[] = bulk ? ['client', 'other'] : ['client', 'family', 'other']
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Who pays<br />
        <select className={inp} aria-label="Who pays" value={draft.kind} disabled={disabled} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind | '' })}>
          <option value="">Not set — the client&apos;s own email, as before</option>
          {kinds.map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
        </select>
      </label>
      {draft.kind === 'family' && (
        <label className="text-sm">Family member<br />
          <select className={inp} aria-label="Family member who pays" value={draft.familyMemberId} disabled={disabled} onChange={(e) => setDraft({ ...draft, familyMemberId: e.target.value })}>
            <option value="">Choose…</option>
            {(members || []).map((m) => <option key={m.id} value={m.id}>{m.name}{m.relationship ? ` (${m.relationship})` : ''}{m.email ? ` — ${m.email}` : ' — no email'}</option>)}
          </select>
        </label>
      )}
      {draft.kind === 'other' && (
        <label className="text-sm">Their name<br />
          <input className={inp} aria-label="Name of the person who pays" value={draft.name} disabled={disabled} maxLength={200} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
      )}
      {draft.kind && (
        <label className="text-sm flex-1 min-w-[16rem]">{draft.kind === 'other' ? 'Email addresses' : 'More email addresses'} <span className="text-gray-500 dark:text-slate-400">(up to {MAX} in all, separated by commas)</span><br />
          <input className={`${inp} w-full`} aria-label="Billing email addresses" value={draft.emails} disabled={disabled} onChange={(e) => setDraft({ ...draft, emails: e.target.value })} placeholder="name@example.com, other@example.com" />
        </label>
      )}
    </div>
  )
}

const draftOf = (r: Row): Draft => ({ kind: r.kind ?? '', familyMemberId: r.familyMemberId ?? '', name: r.contactName ?? '', emails: r.extraEmails.join(', ') })
const bodyOf = (d: Draft) => ({ kind: d.kind || null, familyMemberId: d.familyMemberId || null, name: d.name, emails: splitEmails(d.emails) })

export default function BillingContacts() {
  const may = useMay('care-billing')
  const toast = useToast()
  const [list, setList] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ kind: '', familyMemberId: '', name: '', emails: '' })
  const [members, setMembers] = useState<Member[]>([])
  const [bulk, setBulk] = useState<Draft>({ kind: 'client', familyMemberId: '', name: '', emails: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listAll<Row>('/api/care-billing-contacts/clients')
      .then((r) => setList(rows<Row>(r)))
      .catch((e) => toast.error(errorMessage(e, 'Could not load clients')))
      .finally(() => setLoading(false))
  }, [toast])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? list.filter((r) => `${r.firstName} ${r.lastName} ${r.sendsTo.join(' ')}`.toLowerCase().includes(q)) : list
  }, [list, search])

  const open = async (r: Row) => {
    setEditing(r.clientId)
    setDraft(draftOf(r))
    setMembers([])
    try {
      const one: any = await api.get(`/api/care-billing-contacts/clients/${r.clientId}`)
      setMembers(one?.familyMembers || [])
    } catch (e) { toast.error(errorMessage(e, 'Could not load the family members')) }
  }
  const saveOne = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await api.put(`/api/care-billing-contacts/clients/${editing}`, bodyOf(draft))
      toast.success('Billing contact saved')
      setEditing(null)
      load()
    } catch (e) { toast.error(errorMessage(e)) } finally { setSaving(false) }
  }
  const saveBulk = async () => {
    setSaving(true)
    try {
      const r: any = await api.post('/api/care-billing-contacts/bulk', { clientIds: [...picked], ...bodyOf(bulk) })
      toast.success(`Billing contact set for ${r?.updated ?? picked.size} client${(r?.updated ?? picked.size) === 1 ? '' : 's'}`)
      setPicked(new Set())
      load()
    } catch (e) { toast.error(errorMessage(e)) } finally { setSaving(false) }
  }
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allShown = shown.length > 0 && shown.every((r) => picked.has(r.clientId))

  return (
    <div className="p-4 max-w-5xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Billing contacts</h1>
      <p className="text-sm mb-4 text-gray-600 dark:text-slate-400">Who pays each client&apos;s invoices. Every invoice, reminder, receipt and payment notice goes to all of the addresses listed, up to {MAX}. A client with no billing contact gets them at their own email, as before. A payer&apos;s share of split visits still goes to the payer.</p>

      <input className={`${inp} w-full max-w-sm mb-3`} aria-label="Find a client" placeholder="Find a client or an email…" value={search} onChange={(e) => setSearch(e.target.value)} />

      {may.update && picked.size > 0 && (
        <div className="mb-4 rounded-lg border p-3 border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40" data-testid="billing-bulk">
          <p className="text-sm font-semibold mb-2">Set the same billing contact for {picked.size} client{picked.size === 1 ? '' : 's'}</p>
          <ContactFields draft={bulk} setDraft={setBulk} bulk disabled={saving} />
          <div className="mt-3 flex gap-2">
            <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" onClick={saveBulk} disabled={saving}>Set for {picked.size}</button>
            <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setPicked(new Set())}>Clear selection</button>
          </div>
        </div>
      )}

      {loading ? <p className="text-sm text-gray-600 dark:text-slate-400">Loading…</p> : !shown.length ? (
        <p className="text-sm text-gray-600 dark:text-slate-400">{list.length ? 'No client matches.' : 'No active clients yet.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800/60 text-left">
              <tr>
                {may.update && <th className="p-2 w-8"><input type="checkbox" aria-label="Choose every client shown" checked={allShown} onChange={() => setPicked(allShown ? new Set() : new Set(shown.map((r) => r.clientId)))} /></th>}
                <th className="p-2">Client</th><th className="p-2">Who pays</th><th className="p-2">Invoices go to</th><th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.clientId} className="border-t border-gray-200 dark:border-slate-700 align-top">
                  {may.update && <td className="p-2"><input type="checkbox" aria-label={`Choose ${r.firstName} ${r.lastName}`} checked={picked.has(r.clientId)} onChange={() => toggle(r.clientId)} /></td>}
                  <td className="p-2 font-medium">{r.lastName}, {r.firstName}</td>
                  <td className="p-2">{r.kind ? `${KIND_WORDS[r.kind]}${r.kind === 'other' && r.contactName ? ` — ${r.contactName}` : ''}` : <span className="text-gray-500 dark:text-slate-400">Not set</span>}</td>
                  <td className="p-2">
                    {r.sendsTo.length ? r.sendsTo.join(', ') : <span className="text-red-700 dark:text-red-400">No email address</span>}
                    {r.problem && <p className="text-xs text-red-700 dark:text-red-400">{r.problem}</p>}
                    {editing === r.clientId && (
                      <div className="mt-3 rounded-lg border p-3 border-gray-200 dark:border-slate-700" data-testid="billing-edit">
                        <ContactFields draft={draft} setDraft={setDraft} members={members} disabled={saving || !may.update} />
                        <div className="mt-3 flex gap-2">
                          {may.update && <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" onClick={saveOne} disabled={saving}>Save</button>}
                          <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setEditing(null)}>Close</button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {editing !== r.clientId && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => open(r)}>{may.update ? 'Change' : 'View'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
