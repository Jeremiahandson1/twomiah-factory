// Moved from templates/crm-homecare/frontend/src/components/admin/VitalsTracker.tsx — record and read a client's vitals.
// Quick entry at the top, history below with a trend arrow per measure (latest against the one before). The plausible
// ranges are the server's (clients/medications.ts VITALS); a value outside them is refused with the range named.
import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { api, rows, errorMessage } from '../lib/http'
import { formatAgencyDateTime } from '../lib/agencyClock'

type VitalKey = 'systolicBp' | 'diastolicBp' | 'pulse' | 'respirations' | 'oxygenSaturation' | 'temperatureF' | 'bloodGlucose' | 'weightLbs' | 'painScale'

const FIELDS: Array<{ key: VitalKey; label: string; unit: string; decimal: boolean; range: [number, number] }> = [
  { key: 'systolicBp', label: 'Systolic', unit: 'mmHg', decimal: false, range: [50, 260] },
  { key: 'diastolicBp', label: 'Diastolic', unit: 'mmHg', decimal: false, range: [25, 160] },
  { key: 'pulse', label: 'Pulse', unit: 'bpm', decimal: false, range: [25, 220] },
  { key: 'respirations', label: 'Resp', unit: '/min', decimal: false, range: [4, 70] },
  { key: 'oxygenSaturation', label: 'O₂ Sat', unit: '%', decimal: false, range: [50, 100] },
  { key: 'temperatureF', label: 'Temp', unit: '°F', decimal: true, range: [85, 112] },
  { key: 'bloodGlucose', label: 'Glucose', unit: 'mg/dL', decimal: false, range: [20, 800] },
  { key: 'weightLbs', label: 'Weight', unit: 'lbs', decimal: true, range: [30, 800] },
  { key: 'painScale', label: 'Pain', unit: '0-10', decimal: false, range: [0, 10] },
]

/** A reading of GET /api/medications/vitals/client/:clientId (core/vitals.ts listClientVitals). */
type Reading = { id: string; recordedAt: string; caregiverFirst?: string | null; caregiverLast?: string | null } & Partial<Record<VitalKey, number | string | null>>

const inp = 'w-full px-2 py-1.5 rounded-md border text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const card = 'rounded-xl p-4 shadow-sm bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100'
const fieldLabel = 'block mb-0.5 text-xs font-bold text-gray-600 dark:text-slate-400'

export default function VitalsTracker({ clientId, timeEntryId }: { clientId: string; timeEntryId?: string }) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [painLocation, setPainLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [history, setHistory] = useState<Reading[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!clientId) return
    try {
      setHistory(rows<Reading>(await api.get(`/api/medications/vitals/client/${clientId}`, { limit: 30 })))
    } catch { /* ignore */ }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    // Checked on submit, never clamped while typing.
    const bad = FIELDS.filter((f) => {
      const v = (form[f.key] ?? '').trim()
      if (!v) return false
      const n = Number(v)
      return !Number.isFinite(n) || (!f.decimal && !/^\d+$/.test(v)) || n < f.range[0] || n > f.range[1]
    })
    if (bad.length) { setMsg({ kind: 'err', text: `Check: ${bad.map((f) => `${f.label} (${f.range[0]}–${f.range[1]}${f.decimal ? '' : ', whole number'})`).join(', ')}` }); return }
    setBusy(true)
    try {
      const body: Record<string, unknown> = { clientId, timeEntryId, painLocation: painLocation || null, notes: notes || null }
      FIELDS.forEach((f) => { if ((form[f.key] ?? '').trim() !== '') body[f.key] = form[f.key].trim() })
      await api.post('/api/medications/vitals', body)
      setMsg({ kind: 'ok', text: 'Vitals recorded' })
      setForm({}); setPainLocation(''); setNotes('')
      load()
    } catch (err) {
      setMsg({ kind: 'err', text: errorMessage(err, 'Request failed') })
    } finally { setBusy(false) }
  }

  const trendFor = (key: VitalKey) => {
    const values = history.map((h) => h[key]).filter((v) => v != null && v !== '')
    if (values.length < 2) return null
    const a = parseFloat(String(values[0])); const b = parseFloat(String(values[1]))
    if (isNaN(a) || isNaN(b)) return null
    if (a === b) return { arrow: '→', cls: 'text-gray-500 dark:text-slate-400' }
    return a > b ? { arrow: '▲', cls: 'text-red-600 dark:text-red-400' } : { arrow: '▼', cls: 'text-cyan-700 dark:text-cyan-300' }
  }

  return (
    <div className="grid gap-4">
      <div className={card}>
        <h3 className="mt-0 mb-2 text-base font-semibold">📋 Record Vitals</h3>
        {msg && (
          <div className={`px-3 py-2 rounded-md mb-2 text-sm ${msg.kind === 'ok' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'}`}>{msg.text}</div>
        )}
        <form onSubmit={submit}>
          <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label htmlFor={`vital-${f.key}`} className={fieldLabel}>
                  {f.label} <span className="font-normal">({f.unit})</span>
                </label>
                <input id={`vital-${f.key}`} inputMode={f.decimal ? 'decimal' : 'numeric'} value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className={inp} />
              </div>
            ))}
            <div>
              <label htmlFor="vital-pain-location" className={fieldLabel}>Pain Location</label>
              <input id="vital-pain-location" type="text" value={painLocation} onChange={(e) => setPainLocation(e.target.value)} placeholder="lower back, knee, etc." className={inp} />
            </div>
          </div>
          <div className="mb-2">
            <label htmlFor="vital-notes" className={fieldLabel}>Notes</label>
            <textarea id="vital-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything notable — symptoms, refusal, position, etc." className={inp} />
          </div>
          <button type="submit" disabled={busy} className="px-5 py-2 rounded-md text-sm font-bold bg-teal-700 text-white disabled:opacity-60 dark:bg-teal-700 dark:text-white">
            {busy ? 'Saving…' : '💾 Record Vitals'}
          </button>
        </form>
      </div>

      <div className={card}>
        <h3 className="mt-0 mb-2 text-base font-semibold">📊 Recent Vitals ({history.length})</h3>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">No vitals recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-700 dark:bg-slate-900 dark:text-slate-200">
                  <th className="px-2 py-2 text-left font-bold">When</th>
                  {FIELDS.map((f) => {
                    const trend = trendFor(f.key)
                    return (
                      <th key={f.key} className="px-2 py-2 text-right font-bold">
                        {f.label}{trend && <span className={`ml-1 ${trend.cls}`}>{trend.arrow}</span>}
                      </th>
                    )
                  })}
                  <th className="px-2 py-2 text-left">By</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-gray-100 dark:border-slate-700">
                    <td className="px-2 py-1.5 whitespace-nowrap">{formatAgencyDateTime(h.recordedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    {FIELDS.map((f) => <td key={f.key} className="px-2 py-1.5 text-right">{h[f.key] != null && h[f.key] !== '' ? h[f.key] : '—'}</td>)}
                    <td className="px-2 py-1.5">{h.caregiverFirst ? `${h.caregiverFirst} ${h.caregiverLast?.[0] || ''}.` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
