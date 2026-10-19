// Insurer-portal claim days — ported from CVHC EvvClaimWeek.jsx (the MIDAS claim days page). Moved from
// templates/crm-homecare/frontend/src/components/admin/PortalClaimDays.tsx.
// Per client of one payer, per day of a Sun–Sat week: the EVV-code units (from visits that went through EVV, capped at
// the client's weekly EVV allowance) and the other-code units (everything else). 1 unit = 15 min, rounded per day. The
// portal and both codes are the PAYER's settings — My Choice Wisconsin / MIDAS (S5125 / S5130) is one preset, offered to
// Wisconsin agencies.
//
// Server (server/crm/homecare/billing/invoices.ts): GET /api/billing/claim-portals ({ payers: [{ id, name, payerType,
// claimPortal }], presets }), PUT /api/billing/claim-portals/:payerId ({ claimPortal }), GET
// /api/billing/portal-claim-days ({ payer, portal, weekStart, weekEnd, clients, linkedClients }; each client's shape is
// core/portalClaimDays.ts portalClaimWeek + core/evvWeekly.ts allocateEvvWeek, camelCase).
import { useEffect, useState } from 'react'
import { useToast } from '../../../../shared'
import { api, errorMessage, saveBlob } from '../lib/http'
import { EvvWeeklyUnits } from '../clients/EditClientModal'
import { useMay } from '../lib/useMay'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shiftWeek = (ws: string, n: number) => { const d = new Date(ws + 'T12:00:00'); d.setDate(d.getDate() + 7 * n); return ymd(d) }
const dayLabel = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
const hrs = (u: number) => `${(u * 0.25).toFixed(2).replace(/\.?0+$/, '')}h`

interface PortalConfig { name: string; evvCode: string; evvLabel: string; otherCode: string; otherLabel: string }
type CfgKey = keyof PortalConfig
const EMPTY_CFG: PortalConfig = { name: '', evvCode: '', evvLabel: '', otherCode: '', otherLabel: '' }
interface PortalPayer { id: string; name: string; payerType: string | null; claimPortal: PortalConfig | null }
interface Preset { id: string; label: string; config: PortalConfig }
interface Visit { id: string; clockIn: string; clockOut: string; caregiver: string; minutes: number; sentToSandata: boolean; needsApproval: boolean }
interface Day { date: string; evvUnits: number; homemakerUnits: number; visits: Visit[] }
interface ClaimClient {
  clientId: string; clientName: string; medicaidId: string | null; mcoMemberId: string | null
  evvWeeklyUnits: number | null; weeklyAuthorizedUnits: number | null; inEvv: boolean
  days: Day[]; totals: { evvUnits: number; homemakerUnits: number; evvAuthorizedUnits: number | null }; pendingApproval: number
}
interface Week { weekStart: string; weekEnd: string; clients: ClaimClient[]; linkedClients: number }

export default function PortalClaimDays() {
  // Portal settings need care-billing:update, a client's EVV units care-clients:update (lib/useMay.ts).
  const mayBilling = useMay('care-billing')
  const mayClients = useMay('care-clients')
  const toast = useToast()
  const [payers, setPayers] = useState<PortalPayer[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [payerId, setPayerId] = useState('')
  // Opens on THIS week on the agency's clock: the first load sends no weekStart and the server answers
  // with the Sunday of the agency's today (the laptop computed "last full week" here — Run 4).
  const [weekStart, setWeekStart] = useState('')
  const [evvFor, setEvvFor] = useState<ClaimClient | null>(null) // the client whose EVV units are being entered
  const [data, setData] = useState<Week | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [cfg, setCfg] = useState<PortalConfig>(EMPTY_CFG)

  const loadPayers = async () => {
    try {
      const r: { payers?: PortalPayer[]; presets?: Preset[] } = await api.get('/api/billing/claim-portals')
      setPayers(r?.payers || [])
      setPresets(r?.presets || [])
      const firstSet = (r?.payers || []).find((p) => p.claimPortal)
      if (!payerId && firstSet) setPayerId(firstSet.id)
    } catch (e) { setError(errorMessage(e)) }
  }
  useEffect(() => { loadPayers() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const payer = payers.find((p) => p.id === payerId) || null
  const portal = payer?.claimPortal || null

  const load = async () => {
    if (!payerId || !portal) { setData(null); return }
    setLoading(true); setError('')
    try {
      setData(await api.get('/api/billing/portal-claim-days', { payerId, weekStart: weekStart || undefined }))
    } catch (e) { setError(errorMessage(e)); setData(null) }
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [weekStart, payerId, portal?.name])

  const saveCfg = async (value: PortalConfig | null) => {
    try {
      await api.put(`/api/billing/claim-portals/${payerId}`, { claimPortal: value })
      toast.success(value ? 'Portal export saved' : 'Portal export removed')
      setEditing(false)
      await loadPayers()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  const downloadCsv = () => {
    if (!data || !portal) return
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const out: unknown[][] = [['Client', 'Medicaid ID', 'MCO Member ID', 'Date', 'Procedure', 'Description', 'Units', 'Hours']]
    for (const c of data.clients) {
      for (const d of c.days) {
        if (d.evvUnits > 0) out.push([c.clientName, c.medicaidId, c.mcoMemberId, d.date, portal.evvCode, portal.evvLabel, d.evvUnits, d.evvUnits * 0.25])
        if (d.homemakerUnits > 0) out.push([c.clientName, c.medicaidId, c.mcoMemberId, d.date, portal.otherCode, portal.otherLabel, d.homemakerUnits, d.homemakerUnits * 0.25])
      }
    }
    const blob = new Blob([out.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' })
    saveBlob(blob, `${portal.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-claim-days_${data.weekStart}_to_${data.weekEnd}.csv`)
  }

  const totals = data
    ? data.clients.reduce((t, c) => ({ evv: t.evv + c.totals.evvUnits, other: t.other + c.totals.homemakerUnits, pending: t.pending + c.pendingApproval }), { evv: 0, other: 0, pending: 0 })
    : null
  const th = 'border-b border-gray-200 px-2.5 py-1.5 text-left text-xs text-gray-700 dark:border-slate-700 dark:text-slate-300'
  const td = 'border-b border-gray-100 px-2.5 py-1.5 text-sm text-gray-900 dark:border-slate-800 dark:text-slate-100'
  const FIELDS: Array<[CfgKey, string, string]> = [
    ['name', 'Portal name', 'e.g. MIDAS'],
    ['evvCode', 'EVV procedure code', 'e.g. S5125'],
    ['evvLabel', 'EVV description', 'e.g. Attendant care (EVV)'],
    ['otherCode', 'Other procedure code', 'e.g. S5130'],
    ['otherLabel', 'Other description', 'e.g. Homemaker'],
  ]
  const closeEvv = () => { setEvvFor(null); load() }

  return (
    <div className="max-w-5xl p-4">
      <h2 className="mb-1">Insurer Portal Claim Days</h2>
      <p className="mt-0 text-sm text-gray-600 dark:text-slate-400">
        Per client, per day: the payer's EVV procedure units (from visits that went through EVV, capped at the client's weekly
        EVV units) and its other procedure units (everything else). 1 unit = 15 min, rounded per day — what the office keys
        into the insurer's portal, with the visit times as backup.
      </p>

      <div className="my-4 flex flex-wrap items-end gap-3">
        <div className="form-group" style={{ margin: 0 }}>
          <label htmlFor="pcd-payer">Payer</label>
          <select id="pcd-payer" value={payerId} onChange={(e) => { setPayerId(e.target.value); setEditing(false) }}>
            <option value="">Choose a payer…</option>
            {payers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.claimPortal ? ` — ${p.claimPortal.name}` : ''}</option>)}
          </select>
        </div>
        {mayBilling.update && payer && (
          <button type="button" className="hc-btn hc-btn-secondary" onClick={() => { setCfg(portal || EMPTY_CFG); setEditing(!editing) }}>
            {portal ? '⚙️ Portal settings' : '➕ Set up a portal export'}
          </button>
        )}
      </div>

      {payer && editing && (
        <div className="hc-card">
          <h3 className="mt-0">Portal export for {payer.name}</h3>
          {presets.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-700 dark:text-slate-300">Use a preset:</span>
              {presets.map((p) => <button key={p.id} type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setCfg(p.config)}>{p.label}</button>)}
            </div>
          )}
          <div className="form-grid">
            {FIELDS.map(([k, label, ph]) => (
              <div className="form-group" key={k}>
                <label htmlFor={`pcd-${k}`}>{label}</label>
                <input id={`pcd-${k}`} type="text" value={cfg[k] || ''} placeholder={ph} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="hc-btn hc-btn-primary" onClick={() => saveCfg(cfg)}>Save</button>
            {portal && <button type="button" className="hc-btn hc-btn-danger" onClick={() => saveCfg(null)}>Remove portal export</button>}
            <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {payer && !portal && !editing && (
        <p className="text-sm text-gray-600 dark:text-slate-400">{payer.name} has no portal export yet — set one up to see its claim days.</p>
      )}

      {portal && (
        <div className="my-4 flex flex-wrap items-center gap-2">
          <button type="button" className="hc-btn hc-btn-secondary" disabled={!(weekStart || data?.weekStart)} onClick={() => setWeekStart(shiftWeek(weekStart || data!.weekStart, -1))}>← Prev week</button>
          <strong className="text-gray-900 dark:text-slate-100">{data ? `${dayLabel(data.weekStart)} – ${dayLabel(data.weekEnd)}` : (weekStart || 'This week')}</strong>
          <button type="button" className="hc-btn hc-btn-secondary" disabled={!(weekStart || data?.weekStart)} onClick={() => setWeekStart(shiftWeek(weekStart || data!.weekStart, 1))}>Next week →</button>
          <span className="flex-1" />
          <button type="button" className="hc-btn hc-btn-secondary" onClick={() => window.print()} disabled={!data}>🖨 Print</button>
          <button type="button" className="hc-btn hc-btn-primary" onClick={downloadCsv} disabled={!data || !data.clients.length}>⬇ CSV for {portal.name}</button>
        </div>
      )}

      {loading && <p>Loading…</p>}
      {error && <div className="rounded-lg bg-red-50 p-3 text-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}

      {portal && data && totals && !loading && (
        <>
          <div className="mb-4 flex flex-wrap gap-4">
            <div className="rounded-lg bg-blue-50 px-4 py-2.5 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">{portal.evvCode} {portal.evvLabel}: <strong>{totals.evv} units</strong> ({hrs(totals.evv)})</div>
            <div className="rounded-lg bg-green-50 px-4 py-2.5 text-green-900 dark:bg-green-950/40 dark:text-green-200">{portal.otherCode} {portal.otherLabel}: <strong>{totals.other} units</strong> ({hrs(totals.other)})</div>
            {totals.pending > 0 && <div className="rounded-lg bg-amber-50 px-4 py-2.5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">⚠ {totals.pending} visit{totals.pending === 1 ? '' : 's'} still awaiting approval — review before claiming</div>}
          </div>

          {data.clients.length === 0 && (
            <p className="text-gray-700 dark:text-slate-300">
              {data.linkedClients === 0
                ? <>No client has {payer?.name} as their payer yet. Set it on the client (Edit Client › Payer / referral source); their clocked-out visits then show here.</>
                : <>No finished {payer?.name} visits this week. A visit shows here once the caregiver clocks out, for the {data.linkedClients} client{data.linkedClients === 1 ? '' : 's'} whose payer is {payer?.name}.</>}
            </p>
          )}

          {data.clients.map((c) => (
            <div key={c.clientId} className="mb-4 overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700" style={{ breakInside: 'avoid' }}>
              <div className="flex flex-wrap items-baseline gap-3 bg-gray-50 px-3.5 py-2.5 dark:bg-slate-800">
                <strong className="text-base text-gray-900 dark:text-slate-100">{c.clientName}</strong>
                {c.medicaidId && <span className="text-xs text-gray-600 dark:text-slate-400">MA {c.medicaidId}</span>}
                <span className="flex-1" />
                <span className="text-sm text-gray-900 dark:text-slate-100">
                  EVV <strong>{c.totals.evvUnits}</strong>{c.totals.evvAuthorizedUnits != null ? ` of ${c.totals.evvAuthorizedUnits}` : ''} u · {portal.otherLabel} <strong>{c.totals.homemakerUnits}</strong> u
                </span>
                {!c.inEvv && <span className="text-xs text-gray-600 dark:text-slate-400">(no Medicaid ID — not an EVV client)</span>}
                {c.inEvv && c.totals.evvAuthorizedUnits == null && (
                  <span className="text-xs text-amber-800 dark:text-amber-300">
                    ⚠ "EVV (Sandata) units per week" is blank for {c.clientName}, so all EVV time is claimed as {portal.evvCode}.
                    {c.weeklyAuthorizedUnits != null && ` The ${c.weeklyAuthorizedUnits} weekly authorized units are the total for both codes, not the EVV share.`}
                    {mayClients.update && <>{' '}<button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setEvvFor(c)}>Set EVV units</button></>}
                  </span>
                )}
                {c.inEvv && c.totals.evvAuthorizedUnits != null && c.totals.evvUnits < c.totals.evvAuthorizedUnits && <span className="text-xs text-amber-800 dark:text-amber-300">⚠ under authorized EVV units</span>}
              </div>
              <table className="w-full border-collapse">
                <thead><tr><th className={th}>Day</th><th className={th}>{portal.evvCode} units</th><th className={th}>{portal.otherCode} units</th><th className={th}>Visits</th></tr></thead>
                <tbody>
                  {c.days.map((d) => (
                    <tr key={d.date}>
                      <td className={td}>{dayLabel(d.date)}</td>
                      <td className={td}>{d.evvUnits || '—'}</td>
                      <td className={td}>{d.homemakerUnits || '—'}</td>
                      <td className={`${td} text-xs`}>
                        {d.visits.map((v) => (
                          <div key={v.id}>
                            {v.clockIn}–{v.clockOut} · {v.caregiver} · {v.minutes} min
                            {v.sentToSandata ? ' · EVV' : ''}
                            {v.needsApproval && <span className="text-amber-800 dark:text-amber-300"> · ⚠ needs approval</span>}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}

      {/* The client's EVV share — the same box as Edit Client → "EVV (Sandata) Units Per Week". */}
      {evvFor && (
        <div className="modal active" onClick={closeEvv}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>EVV units for {evvFor.clientName}</h3>
              <button type="button" className="modal-close" aria-label="Close" onClick={closeEvv}>×</button>
            </div>
            <EvvWeeklyUnits clientId={evvFor.clientId} initialUnits={evvFor.evvWeeklyUnits} />
            <div className="modal-actions">
              <button type="button" className="hc-btn hc-btn-secondary" onClick={closeEvv}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
