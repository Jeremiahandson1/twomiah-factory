// Moved from templates/crm-homecare/frontend/src/components/caregiver/VisitCarePanel.tsx.
// What a caregiver records DURING a visit, beside the task checklist (server/crm/homecare/clients/medications.ts and
// visits/timeTracking.ts):
//   · Medications (MAR)  GET /api/medications/due/:clientId ({ data }: id, medicationName, dosage, route, frequency,
//                        instructions, isPrn), GET /api/medications/logs/time-entry/:id ({ data }: medicationId, status),
//                        POST /api/medications/log        (shown when the client has active medications)
//   · Vitals             POST /api/medications/vitals, GET /api/medications/vitals/latest/:clientId (the reading, or {})
//   · Photo now          POST /api/time-entries/:id/photos (uploaded at once, not held for clock-out)
// The server decides who may write (a caregiver, for their own visit, for a client they serve) and says why when it
// refuses; that message is shown here as it came.
//
// Changes from the template: no token (the app's client); the lists are { data } rows and every field camelCase
// (medication_id → medicationId, systolic_bp → systolicBp …); the app's toast; the main button is emerald-700 in both
// themes (white on emerald-600 was 3.8:1).
import { useEffect, useRef, useState } from 'react'
import { api, rows, errorMessage } from '../../lib/http'
import { useToast } from '../../../../../shared'
import { compressPhoto } from '../../lib/visitPhoto'

const MAR_ACTIONS: { status: string; label: string }[] = [
  { status: 'given', label: 'Given' },
  { status: 'self_administered', label: 'Self-administered' },
  { status: 'refused', label: 'Refused' },
  { status: 'held', label: 'Held' },
  { status: 'missed', label: 'Missed' },
]
const statusLabel = (s: string) => (MAR_ACTIONS.find((a) => a.status === s)?.label || s)

// The plausible ranges the server enforces (clients/medications.ts VITALS) — shown as hints.
const VITAL_FIELDS: { key: string; label: string; hint: string; decimal?: boolean }[] = [
  { key: 'systolicBp', label: 'BP top (systolic)', hint: '50–260' },
  { key: 'diastolicBp', label: 'BP bottom (diastolic)', hint: '25–160' },
  { key: 'pulse', label: 'Pulse (beats/min)', hint: '25–220' },
  { key: 'respirations', label: 'Breaths/min', hint: '4–70' },
  { key: 'oxygenSaturation', label: 'Oxygen (SpO2 %)', hint: '50–100' },
  { key: 'temperatureF', label: 'Temperature (°F)', hint: '85–112', decimal: true },
  { key: 'bloodGlucose', label: 'Blood sugar (mg/dL)', hint: '20–800' },
  { key: 'weightLbs', label: 'Weight (lb)', hint: '30–800', decimal: true },
  { key: 'painScale', label: 'Pain (0–10)', hint: '0–10' },
]

/** A row of GET /api/medications/due/:clientId. */
interface Medication {
  id: string
  medicationName?: string | null
  name?: string | null
  dosage?: string | null
  route?: string | null
  frequency?: string | null
  instructions?: string | null
  isPrn?: boolean | null
}

/** A row of GET /api/medications/logs/time-entry/:id. */
interface MedLog { id: string; medicationId: string; status: string }

/** GET /api/medications/vitals/latest/:clientId — the latest reading, or {} when there is none. */
interface Vitals {
  systolicBp?: number | null
  diastolicBp?: number | null
  pulse?: number | null
  temperatureF?: string | number | null
  oxygenSaturation?: number | null
}

// Every ink is paired with its ground, light and dark.
const SECTION = 'rounded-lg border p-3 mb-2 border-gray-200 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const H = 'text-sm font-bold text-gray-900 dark:text-slate-100'
const MUTED = 'text-xs text-gray-600 dark:text-slate-300'
const BTN = 'px-2.5 py-1.5 rounded-md text-xs font-semibold border disabled:opacity-60'
const BTN_MAIN = `${BTN} border-emerald-700 bg-emerald-700 text-white dark:border-emerald-700 dark:bg-emerald-700 dark:text-white`
const BTN_PLAIN = `${BTN} border-gray-300 bg-white text-gray-800 dark:border-slate-500 dark:bg-slate-900 dark:text-slate-100`
const INPUT = 'w-full rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const ERR = 'mt-2 rounded-md px-2 py-1.5 text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
const OK = 'mt-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300'

export default function VisitCarePanel({ timeEntryId, clientId }: { timeEntryId: string; clientId: string }) {
  const toast = useToast()

  // ── medications ───────────────────────────────────────────
  const [meds, setMeds] = useState<Medication[]>([])
  const [logs, setLogs] = useState<MedLog[]>([])
  const [busyMed, setBusyMed] = useState<string | null>(null)
  const [medError, setMedError] = useState('')
  const loadMeds = async () => {
    const [m, l] = await Promise.all([
      api.get(`/api/medications/due/${clientId}`).catch(() => null),
      api.get(`/api/medications/logs/time-entry/${timeEntryId}`).catch(() => null),
    ])
    if (m) setMeds(rows<Medication>(m))
    if (l) setLogs(rows<MedLog>(l))
  }
  const medName = (med: Medication) => med.medicationName || med.name || ''
  const recordDose = async (med: Medication, status: string) => {
    setBusyMed(med.id); setMedError('')
    try {
      await api.post('/api/medications/log', { medicationId: med.id, clientId, timeEntryId, status })
    } catch (e) {
      setBusyMed(null)
      setMedError(errorMessage(e, 'Not recorded — try again'))
      return
    }
    setBusyMed(null)
    toast.success(`${medName(med)}: ${statusLabel(status)}`)
    loadMeds()
  }

  // ── vitals ────────────────────────────────────────────────
  const [vitalsOpen, setVitalsOpen] = useState(false)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [vitalsNote, setVitalsNote] = useState('')
  const [vitalsSaving, setVitalsSaving] = useState(false)
  const [vitalsError, setVitalsError] = useState('')
  const [latest, setLatest] = useState<Vitals | null>(null)
  const loadLatest = async () => {
    try { setLatest(await api.get(`/api/medications/vitals/latest/${clientId}`)) } catch { /* keep what we had */ }
  }
  const saveVitals = async () => {
    const body: Record<string, unknown> = { clientId, timeEntryId, notes: vitalsNote.trim() || null }
    let any = false
    for (const f of VITAL_FIELDS) if (vals[f.key]?.trim()) { body[f.key] = vals[f.key].trim(); any = true }
    if (!any) { setVitalsError('Enter at least one reading.'); return }
    setVitalsSaving(true); setVitalsError('')
    try {
      await api.post('/api/medications/vitals', body)
    } catch (e) {
      setVitalsSaving(false)
      setVitalsError(errorMessage(e, 'Vitals not saved — check the numbers'))
      return
    }
    setVitalsSaving(false)
    toast.success('Vitals saved')
    setVals({}); setVitalsNote(''); setVitalsOpen(false)
    loadLatest()
  }
  const lastLine = latest
    ? [latest.systolicBp && latest.diastolicBp ? `BP ${latest.systolicBp}/${latest.diastolicBp}` : null,
       latest.pulse ? `pulse ${latest.pulse}` : null,
       latest.temperatureF ? `${latest.temperatureF}°F` : null,
       latest.oxygenSaturation ? `SpO2 ${latest.oxygenSaturation}%` : null].filter(Boolean).join(', ')
    : ''

  // ── photo now ─────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [photoCaption, setPhotoCaption] = useState('')
  const [photoSending, setPhotoSending] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [photosSent, setPhotosSent] = useState(0)
  const sendPhoto = async (file?: File | null) => {
    if (!file) return
    setPhotoError(''); setPhotoSending(true)
    try {
      const { dataUri } = await compressPhoto(file)
      await api.post(`/api/time-entries/${timeEntryId}/photos`, { imageBase64: dataUri, caption: photoCaption.trim() || null, category: 'task' })
      setPhotosSent((n) => n + 1); setPhotoCaption('')
      toast.success('Photo added to this visit')
    } catch (e) { setPhotoError(errorMessage(e, 'Photo not sent — try again')) }
    finally { setPhotoSending(false) }
  }

  useEffect(() => { loadMeds(); loadLatest(); setPhotosSent(0) }, [timeEntryId, clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-2">
      {meds.length > 0 && (
        <div className={SECTION}>
          <div className={H}>💊 Medications</div>
          {meds.map((med) => {
            const mine = logs.filter((l) => l.medicationId === med.id)
            const last = mine[mine.length - 1]
            return (
              <div key={med.id} className="mt-2 border-t pt-2 border-gray-200 dark:border-slate-600">
                <div className="text-sm font-semibold">{medName(med)}{med.isPrn ? ' (as needed)' : ''}</div>
                <div className={MUTED}>{[med.dosage, med.route, med.frequency].filter(Boolean).join(' · ')}</div>
                {med.instructions && <div className={MUTED}>{med.instructions}</div>}
                {last && <div className={OK}>Recorded this visit: {statusLabel(last.status)}</div>}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {MAR_ACTIONS.map((a) => (
                    <button key={a.status} type="button" disabled={!!busyMed}
                      className={a.status === 'given' ? BTN_MAIN : BTN_PLAIN}
                      onClick={() => recordDose(med, a.status)}>
                      {busyMed === med.id && a.status === 'given' ? 'Saving…' : a.label}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          {medError && <div role="alert" className={ERR}>{medError}</div>}
        </div>
      )}

      <div className={SECTION}>
        <div className="flex items-center justify-between gap-2">
          <div className={H}>🩺 Vitals</div>
          <button type="button" className={BTN_PLAIN} onClick={() => { setVitalsOpen((v) => !v); setVitalsError('') }}>
            {vitalsOpen ? 'Close' : 'Record vitals'}
          </button>
        </div>
        {lastLine && <div className={`${MUTED} mt-1`}>Last recorded: {lastLine}</div>}
        {vitalsOpen && (
          <div className="mt-2">
            <div className="grid grid-cols-2 gap-2">
              {VITAL_FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className={MUTED}>{f.label} <span className="text-gray-600 dark:text-slate-400">({f.hint})</span></span>
                  <input className={INPUT} inputMode={f.decimal ? 'decimal' : 'numeric'} value={vals[f.key] || ''}
                    onChange={(e) => { setVals((p) => ({ ...p, [f.key]: e.target.value })); setVitalsError('') }} />
                </label>
              ))}
            </div>
            <label className="mt-2 block">
              <span className={MUTED}>Notes</span>
              <textarea className={INPUT} rows={2} value={vitalsNote} onChange={(e) => setVitalsNote(e.target.value)}
                placeholder="Anything the nurse or office should know" />
            </label>
            {vitalsError && <div role="alert" className={ERR}>{vitalsError}</div>}
            <button type="button" className={`${BTN_MAIN} mt-2`} disabled={vitalsSaving} onClick={saveVitals}>
              {vitalsSaving ? 'Saving…' : 'Save vitals'}
            </button>
          </div>
        )}
      </div>

      <div className={SECTION}>
        <div className={H}>📷 Photo</div>
        <div className={MUTED}>Added to this visit right away{photosSent > 0 ? ` · ${photosSent} added` : ''}.</div>
        <input className={`${INPUT} mt-2`} value={photoCaption} onChange={(e) => setPhotoCaption(e.target.value)} placeholder="Caption (optional)" maxLength={200} />
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { sendPhoto(e.target.files?.[0]); e.target.value = '' }} />
        <button type="button" className={`${BTN_MAIN} mt-2`} disabled={photoSending} onClick={() => fileRef.current?.click()}>
          {photoSending ? 'Sending…' : 'Take or add a photo'}
        </button>
        {photoError && <div role="alert" className={ERR}>{photoError}</div>}
      </div>
    </div>
  )
}
