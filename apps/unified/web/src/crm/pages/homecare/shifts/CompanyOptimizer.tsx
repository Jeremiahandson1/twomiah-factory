// Moved from templates/crm-homecare/frontend/src/components/admin/CompanyOptimizer.tsx.
// Company-Wide Smart Matching & Schedule Optimizer.
//
// The server behind this screen (server/crm/homecare/scheduling/matching.ts, moved unchanged in shape from the
// template's routes/matching.ts) is much smaller than the screen the template drew, and the template's screen did not
// fit it: it sent capability objects that the server stored as "[object Object]", and its Client Needs tab and its
// optimizer results threw on render (the replies are not the arrays and fields it read). Each tab here reads what the
// unified server actually answers, and what the server cannot store is said on the screen rather than pretended:
//   Caregiver Skills  GET  /api/matching/capabilities              → list reply of capability NAMES (free text, from
//                                                                   caregiver profiles), no id / category / icon.
//                     GET  /api/matching/caregiver/:id/capabilities → list reply of that caregiver's names.
//                     PUT  /api/matching/caregiver/:id/capabilities { capabilities: string[] } (the route joins them).
//                     A new capability joins the list on the screen and is stored when it is ticked for a caregiver
//                     and saved (the template also POSTed it to a route that did nothing; not moved).
//   Restrictions      GET  /api/matching/client/:id/restrictions    → list reply of client_assignments rows
//                                                                   (status 'restricted', caregiverId, notes); no type.
//                     POST …/restrictions { caregiverId, notes }    → the row. DELETE /api/matching/restrictions/:id.
//   Run Optimizer     POST /api/matching/optimize                   → { assignments: [{ clientId, clientName,
//                                                                   suggestedCaregivers: [{ caregiverId, caregiverName,
//                                                                   score }] }], summary: { totalClients, covered,
//                                                                   uncovered, coveragePercent } }.
//
// Taken out (2026-10-19): the Client Needs tab (nothing on it could be saved: the server keeps no per-client service
// needs or service days), the optimizer's week, mode and three options (the matcher reads none of them), and "Apply All
// to Schedule" (its route answered success and applied nothing). Each looked like it worked and did not.
import { useState, useEffect, type CSSProperties } from 'react'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { CHIP, EDGE, INK, SOLID, type Tone } from './ui'
import { useMay } from '../lib/useMay'

interface Person { id: string; firstName: string | null; lastName: string | null; isActive?: boolean | null; weeklyAuthorizedUnits?: number | null }
interface Restriction { id: string; caregiverId: string; notes: string | null }
interface Suggestion { caregiverId: string; caregiverName: string; score: number }
interface Assignment { clientId: string; clientName: string; suggestedCaregivers: Suggestion[] }
interface OptimizeReply {
  assignments: Assignment[]
  summary: { totalClients: number; covered: number; uncovered: number; coveragePercent: number }
}

type Tab = 'skills' | 'restrictions' | 'optimizer'
type MsgType = 'success' | 'error' | 'warning' | ''


const CompanyOptimizer = () => {
  // Skills, restrictions and the optimizer are all care-schedule:update (scheduling/matching.ts) — lib/useMay.ts.
  const may = useMay('care-schedule')
  const [activeTab, setActiveTab] = useState<Tab>('skills')
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [caregivers, setCaregivers] = useState<Person[]>([])
  const [clients, setClients] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ text: string; type: MsgType }>({ text: '', type: '' })

  const [selectedCg, setSelectedCg] = useState('')
  const [cgCaps, setCgCaps] = useState<string[]>([])
  const [cgCapsLoading, setCgCapsLoading] = useState(false)

  const [restrictionsClient, setRestrictionsClient] = useState('')
  const [restrictions, setRestrictions] = useState<Restriction[]>([])
  const [newRestriction, setNewRestriction] = useState({ caregiverId: '', reason: '' })

  const [optimizerResults, setOptimizerResults] = useState<OptimizeReply | null>(null)
  const [optimizing, setOptimizing] = useState(false)

  const [showNewCap, setShowNewCap] = useState(false)
  const [newCapName, setNewCapName] = useState('')

  const showMsg = (text: string, type: MsgType = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage({ text: '', type: '' }), 5000)
  }

  useEffect(() => {
    Promise.all([api.get('/api/matching/capabilities'), listAll('/api/caregivers'), listAll('/api/clients')])
      .then(([caps, cgs, cls]) => {
        setCapabilities(rows<string>(caps).map(String))
        setCaregivers(rows<Person>(cgs))
        setClients(rows<Person>(cls).filter((c) => c.isActive !== false))
      }).catch(console.error).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedCg) { setCgCaps([]); return }
    setCgCapsLoading(true)
    api.get(`/api/matching/caregiver/${encodeURIComponent(selectedCg)}/capabilities`)
      .then((r) => setCgCaps(rows<string>(r).map(String)))
      .catch(console.error).finally(() => setCgCapsLoading(false))
  }, [selectedCg])

  const loadRestrictions = (clientId: string) =>
    api.get(`/api/matching/client/${encodeURIComponent(clientId)}/restrictions`).then((r) => setRestrictions(rows<Restriction>(r)))

  useEffect(() => {
    if (!restrictionsClient) { setRestrictions([]); return }
    loadRestrictions(restrictionsClient).catch(console.error)
  }, [restrictionsClient])

  const nameOf = (id: string) => {
    const p = caregivers.find((c) => c.id === id)
    return p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : 'Unknown caregiver'
  }

  // ── Caregiver skills helpers ──
  const cgHasCap = (cap: string) => cgCaps.includes(cap)
  const toggleCgCap = (cap: string) => setCgCaps((p) => (p.includes(cap) ? p.filter((c) => c !== cap) : [...p, cap]))
  const saveCgCaps = async () => {
    try {
      await api.put(`/api/matching/caregiver/${encodeURIComponent(selectedCg)}/capabilities`, { capabilities: cgCaps })
      showMsg('Skills saved!')
    } catch (e) { showMsg(errorMessage(e), 'error') }
  }

  // ── Restrictions helpers ──
  const addRestriction = async () => {
    if (!newRestriction.caregiverId) { showMsg('Select a caregiver', 'error'); return }
    try {
      await api.post(`/api/matching/client/${encodeURIComponent(restrictionsClient)}/restrictions`, { caregiverId: newRestriction.caregiverId, notes: newRestriction.reason || null })
      await loadRestrictions(restrictionsClient)
      setNewRestriction({ caregiverId: '', reason: '' })
      showMsg('Restriction added')
    } catch (e) { showMsg(errorMessage(e), 'error') }
  }
  const removeRestriction = async (id: string) => {
    try {
      await api.delete(`/api/matching/restrictions/${encodeURIComponent(id)}`)
      setRestrictions((p) => p.filter((r) => r.id !== id))
      showMsg('Removed')
    } catch (e) { showMsg(errorMessage(e), 'error') }
  }

  // ── Optimizer ──
  const runOptimizer = async () => {
    setOptimizing(true); setOptimizerResults(null)
    try {
      const data = (await api.post('/api/matching/optimize', {})) as OptimizeReply
      const result: OptimizeReply = {
        assignments: Array.isArray(data?.assignments) ? data.assignments : [],
        summary: data?.summary || { totalClients: 0, covered: 0, uncovered: 0, coveragePercent: 0 },
      }
      setOptimizerResults(result)
      showMsg(`${result.summary.coveragePercent}% coverage · ${result.summary.covered}/${result.summary.totalClients} clients have a suggested caregiver`)
    } catch (e) { showMsg('Failed: ' + errorMessage(e), 'error') }
    finally { setOptimizing(false) }
  }

  // A capability exists once a caregiver has it (the server keeps them as free text on each caregiver's profile): a new
  // one joins the list here and is stored when it is ticked for a caregiver and saved.
  const addCapability = () => {
    const name = newCapName.trim()
    if (!name) { showMsg('Name required', 'error'); return }
    if (name.includes(',')) { showMsg('A capability name cannot contain a comma', 'error'); return }
    setCapabilities((p) => (p.includes(name) ? p : [...p, name].sort()))
    setNewCapName('')
    setShowNewCap(false)
    showMsg('Added. Tick it for a caregiver and save to keep it.')
  }

  // ── Styles: the frame's tokens and light/dark pairs (./ui.ts) ──
  const s = {
    page: { maxWidth: '1100px', margin: '0 auto', padding: '1rem', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: 'var(--hc-ink)' } as CSSProperties,
    tabs: { display: 'flex', gap: '4px', marginBottom: '1rem', overflowX: 'auto', borderBottom: '2px solid var(--hc-line)', paddingBottom: '2px' } as CSSProperties,
    tab: (a: boolean): CSSProperties => ({ padding: '0.55rem 1rem', border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: a ? 700 : 500, background: a ? SOLID.blue : 'transparent', color: a ? '#fff' : 'var(--hc-ink-soft)', borderRadius: '8px 8px 0 0', whiteSpace: 'nowrap' }),
    card: { background: 'var(--hc-surface)', borderRadius: '10px', padding: '1rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', border: '1px solid var(--hc-line)', marginBottom: '0.85rem' } as CSSProperties,
    cardTitle: { fontWeight: 800, fontSize: '0.95rem', marginBottom: '0.65rem' } as CSSProperties,
    label: { display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--hc-ink-soft)', textTransform: 'uppercase', marginBottom: '3px' } as CSSProperties,
    select: { width: '100%', padding: '0.45rem 0.6rem', border: '1px solid var(--hc-line)', borderRadius: '6px', fontSize: '0.88rem', background: 'var(--hc-surface)', color: 'var(--hc-ink)' } as CSSProperties,
    input: { width: '100%', padding: '0.45rem 0.6rem', border: '1px solid var(--hc-line)', borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box', background: 'var(--hc-surface)', color: 'var(--hc-ink)' } as CSSProperties,
    btn: (bg: string, dis = false): CSSProperties => ({ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', cursor: dis ? 'not-allowed' : 'pointer', fontSize: '0.82rem', fontWeight: 700, color: '#fff', background: dis ? SOLID.gray : bg, opacity: dis ? 0.6 : 1 }),
    btnSm: (bg: string): CSSProperties => ({ padding: '0.3rem 0.6rem', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, color: '#fff', background: bg }),
    btnGhost: { padding: '0.3rem 0.6rem', borderWidth: 1, borderStyle: 'solid', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, background: 'transparent' } as CSSProperties,
    msg: (t: MsgType): CSSProperties => {
      const k = t === 'error' ? 'danger' : t === 'warning' ? 'warning' : 'success'
      return { padding: '0.55rem 0.85rem', borderRadius: '8px', marginBottom: '0.75rem', fontSize: '0.82rem', fontWeight: 600, background: `var(--hc-${k}-bg)`, color: `var(--hc-${k}-ink)`, border: `1px solid var(--hc-${k}-line)` }
    },
    notice: { padding: '0.75rem 0.9rem', borderRadius: '8px', fontSize: '0.84rem', background: 'var(--hc-info-bg)', color: 'var(--hc-info-ink)', border: '1px solid var(--hc-info-line)', marginBottom: '0.85rem' } as CSSProperties,
    capGrid: { display: 'grid', gap: '6px', marginBottom: '0.75rem' } as CSSProperties,
    capItem: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.65rem', borderWidth: 2, borderStyle: 'solid', borderRadius: '8px', cursor: 'pointer' } as CSSProperties,
    stat: { flex: '1 1 80px', padding: '0.5rem', textAlign: 'center', borderRadius: '8px', background: 'var(--hc-surface)', borderWidth: 1, borderStyle: 'solid' } as CSSProperties,
    statVal: { fontSize: '1.2rem', fontWeight: 800 } as CSSProperties,
    statLbl: { fontSize: '0.65rem', color: 'var(--hc-ink-soft)', fontWeight: 600, textTransform: 'uppercase' } as CSSProperties,
    emptyState: { textAlign: 'center', padding: '2rem', color: 'var(--hc-ink-soft)' } as CSSProperties,
    row: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.65rem' } as CSSProperties,
    col: (f?: number): CSSProperties => ({ flex: f || 1, minWidth: '140px' }),
  }
  // A ticked / unticked capability box: its edge and ground, light and dark.
  const capCls = (a: boolean) => (a ? 'border-blue-600 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40' : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900')
  const ghostBlue = 'text-blue-700 border-blue-700 dark:text-blue-300 dark:border-blue-300'
  const ghostSoft = 'text-gray-600 border-gray-500 dark:text-slate-300 dark:border-slate-400'

  // ═══════════════════════════════════════════════
  // RENDER: Skills Tab
  // ═══════════════════════════════════════════════
  const renderSkills = () => (
    <div>
      <div style={s.card}>
        <div style={s.cardTitle}>👤 Caregiver Skills & Capabilities</div>
        <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)', marginBottom: '0.75rem' }}>
          Check off what each caregiver can do. It is kept on their profile for the office to see.
        </div>
        <div style={s.row}>
          <div style={s.col(2)}>
            <label style={s.label}>Caregiver</label>
            <select style={s.select} value={selectedCg} onChange={(e) => setSelectedCg(e.target.value)}>
              <option value="">— Select —</option>
              {caregivers.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
            </select>
          </div>
          {selectedCg && <div style={{ ...s.col(1), display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
            {may.update && <button style={s.btn(SOLID.green)} onClick={saveCgCaps}>💾 Save</button>}
            <span style={{ fontSize: '0.78rem', color: 'var(--hc-ink-soft)' }}>{cgCaps.length}/{capabilities.length}</span>
          </div>}
        </div>
      </div>
      {selectedCg && !cgCapsLoading && (
        <div style={s.card}>
          <div style={s.cardTitle}>Capabilities</div>
          {capabilities.length === 0 ? (
            <div style={s.emptyState}>No capabilities yet — add one below.</div>
          ) : (
            <div style={s.capGrid}>
              {capabilities.map((cap) => {
                const a = cgHasCap(cap)
                return (
                  <div key={cap} className={capCls(a)} style={s.capItem} onClick={may.update ? () => toggleCgCap(cap) : undefined}>
                    <input type="checkbox" checked={a} readOnly style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.86rem' }}>{cap}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      {may.update && <div style={s.card}>
        {!showNewCap ? <button className={ghostBlue} style={s.btnGhost} onClick={() => setShowNewCap(true)}>+ Add Custom Capability</button> : (
          <div>
            <div style={s.row}>
              <div style={s.col(2)}><label style={s.label}>Name</label><input style={s.input} value={newCapName} onChange={(e) => setNewCapName(e.target.value)} placeholder="e.g., Bilingual (Spanish)" /></div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}><button style={s.btn(SOLID.green)} onClick={addCapability}>Add</button><button className={ghostSoft} style={s.btnGhost} onClick={() => setShowNewCap(false)}>Cancel</button></div>
          </div>
        )}
      </div>}
    </div>
  )

  // ═══════════════════════════════════════════════
  // RENDER: Restrictions Tab
  // ═══════════════════════════════════════════════
  const renderRestrictions = () => (
    <div>
      <div style={s.card}>
        <div style={s.cardTitle}>🔒 Client-Caregiver Restrictions</div>
        <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)', marginBottom: '0.75rem' }}>
          A caregiver restricted for a client, with an internal note. (The kind of restriction — preferred, excluded or
          locked — is not stored by the server yet; each is recorded as a restriction.)
        </div>
        <div style={s.col(2)}><label style={s.label}>Client</label>
          <select style={s.select} value={restrictionsClient} onChange={(e) => setRestrictionsClient(e.target.value)}>
            <option value="">— Select —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
          </select>
        </div>
      </div>
      {restrictionsClient && (<>
        {may.update && <div style={s.card}>
          <div style={s.cardTitle}>➕ Add Restriction</div>
          <div style={s.row}>
            <div style={s.col(2)}><label style={s.label}>Caregiver</label>
              <select style={s.select} value={newRestriction.caregiverId} onChange={(e) => setNewRestriction((p) => ({ ...p, caregiverId: e.target.value }))}>
                <option value="">— Select —</option>
                {caregivers.filter((c) => !restrictions.some((r) => r.caregiverId === c.id)).map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '0.5rem' }}><label style={s.label}>Reason (admin-only)</label>
            <input style={s.input} value={newRestriction.reason} onChange={(e) => setNewRestriction((p) => ({ ...p, reason: e.target.value }))} placeholder="Internal note — not visible to caregivers or families" />
          </div>
          <button style={s.btn(SOLID.blue)} onClick={addRestriction}>Add</button>
        </div>}
        {restrictions.length === 0 ? <div style={{ ...s.card, ...s.emptyState }}>No restrictions set — all caregivers eligible</div>
        : (
          <div style={s.card}>
            <div className={INK.red} style={s.cardTitle}>🚫 Restricted ({restrictions.length})</div>
            {restrictions.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.5rem 0.65rem', borderRadius: '6px', marginBottom: '4px', background: 'var(--hc-danger-bg)', border: '1px solid var(--hc-danger-line)' }}>
                <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--hc-ink)' }}>{nameOf(r.caregiverId)}</div>
                  {r.notes && <div style={{ fontSize: '0.72rem', color: 'var(--hc-ink)', fontStyle: 'italic' }}>{r.notes}</div>}
                </div>
                {may.update && <button style={s.btnSm(SOLID.red)} onClick={() => removeRestriction(r.id)}>Remove</button>}
              </div>
            ))}
          </div>
        )}
      </>)}
    </div>
  )

  // ═══════════════════════════════════════════════
  // RENDER: Optimizer Tab
  // ═══════════════════════════════════════════════
  const renderOptimizer = () => {
    const r = optimizerResults
    const coverageTone: Tone = !r ? 'gray' : r.summary.coveragePercent >= 90 ? 'green' : r.summary.coveragePercent >= 70 ? 'amber' : 'red'
    return (
      <div>
        <div style={s.card}>
          <div style={s.cardTitle}>🧠 Company-Wide Schedule Optimizer</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)', marginBottom: '0.75rem' }}>
            Ranks caregivers for each active client: their preferred caregivers first, their do-not-use caregivers left out.
          </div>
          {may.update && <button style={s.btn(SOLID.violet, optimizing)} onClick={runOptimizer} disabled={optimizing}>
            {optimizing ? '⏳ Optimizing...' : '🚀 Run Optimizer'}
          </button>}
        </div>

        {r && (<div>
          {/* Summary */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
            {([
              { v: `${r.summary.coveragePercent}%`, l: 'Coverage', tone: coverageTone },
              { v: r.summary.totalClients, l: 'Clients', tone: 'blue' },
              { v: r.summary.covered, l: 'Covered', tone: 'green' },
              { v: r.summary.uncovered, l: 'Uncovered', tone: r.summary.uncovered > 0 ? 'red' : 'gray' },
            ] as Array<{ v: string | number; l: string; tone: Tone }>).map((st, i) => (
              <div key={i} className={EDGE[st.tone]} style={s.stat}><div className={INK[st.tone]} style={s.statVal}>{st.v}</div><div style={s.statLbl}>{st.l}</div></div>
            ))}
          </div>

          {/* Client assignments */}
          <div style={s.card}>
            <div style={s.cardTitle}>📋 Assignments ({r.assignments.length} clients)</div>
            {r.assignments.map((a) => {
              const none = a.suggestedCaregivers.length === 0
              return (
                <div key={a.clientId} style={{
                  padding: '0.65rem', borderRadius: '8px', marginBottom: '6px',
                  border: `1px solid ${none ? 'var(--hc-danger-line)' : 'var(--hc-success-line)'}`,
                  background: none ? 'var(--hc-danger-bg)' : 'var(--hc-success-bg)',
                }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--hc-ink)' }}>{a.clientName}</div>
                  <div style={{ display: 'flex', gap: '4px', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                    {none ? (
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--hc-danger-ink)' }}>⚠️ No eligible caregiver</span>
                    ) : a.suggestedCaregivers.map((sg, i) => (
                      <span key={sg.caregiverId} className={CHIP[i === 0 ? 'blue' : 'gray']} style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600 }}>
                        {sg.caregiverName} · {sg.score}pts
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>)}
      </div>
    )
  }

  if (loading) return <div style={{ ...s.page, textAlign: 'center', padding: '3rem', color: 'var(--hc-ink-soft)' }}>Loading...</div>

  return (
    <div style={s.page}>
      <h1 style={{ fontSize: '1.35rem', fontWeight: 800, marginBottom: '1rem' }}>🧠 Smart Matching & Optimizer</h1>
      {message.text && <div style={s.msg(message.type)}>{message.text}</div>}
      <div style={s.tabs}>
        {([{ id: 'skills', i: '👤', l: 'Caregiver Skills' }, { id: 'restrictions', i: '🔒', l: 'Restrictions' }, { id: 'optimizer', i: '🧠', l: 'Run Optimizer' }] as Array<{ id: Tab; i: string; l: string }>).map((t) => (
          <button key={t.id} style={s.tab(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>{t.i} {t.l}</button>
        ))}
      </div>
      {activeTab === 'skills' && renderSkills()}
      {activeTab === 'restrictions' && renderRestrictions()}
      {activeTab === 'optimizer' && renderOptimizer()}
    </div>
  )
}

export default CompanyOptimizer
