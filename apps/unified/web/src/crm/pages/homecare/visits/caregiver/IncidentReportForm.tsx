// Moved from templates/crm-homecare/frontend/src/components/caregiver/IncidentReportForm.tsx — a caregiver reports an
// incident from the field. Posts to POST /api/incidents/caregiver-report (server/crm/homecare/office/incidents.ts). The
// office gets an incident_alert notification and the report lands in Clinical → Incidents as an open case. The client
// picker is the server's own "your clients" list (GET /api/incidents/my-clients), so it can never offer a client the
// server would refuse.
//
// Changes from the template: no token (incidentsApi now takes none); the client list is { data } rows, camelCase
// (first_name → firstName); the app's toast; the Done button is teal-700 in both themes (the dark theme's teal-600
// carried white at 3.7:1); the red buttons are red-700 in both.
import { useEffect, useState } from 'react'
import { rows, errorMessage } from '../../lib/http'
import { useToast } from '../../../../../shared'
import { INCIDENT_TYPES, incidentsApi, localToday, FIELD, LABEL } from '../../lib/incidentOptions'

const MAX_PHOTOS = 3

/** A row of GET /api/incidents/my-clients. */
interface ReportableClient { id: string; firstName: string | null; lastName: string | null }

const IncidentReportForm = ({ onClose }: { onClose: () => void }) => {
  const toast = useToast()
  const [clients, setClients] = useState<ReportableClient[]>([])
  const [clientsError, setClientsError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [photos, setPhotos] = useState<Array<{ dataUri: string; fileName: string }>>([])
  const [form, setForm] = useState({
    clientId: '',
    incidentType: '',
    incidentDate: localToday(),
    incidentTime: '',
    description: '',
    injuriesOrDamage: '',
    actionsTaken: '',
    witnesses: '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    incidentsApi('/my-clients')
      .then((reply) => setClients(rows<ReportableClient>(reply)))
      .catch((e) => setClientsError(errorMessage(e, 'Could not load your clients')))
  }, [])

  // Downscale to JPEG: max 1600px, ~82% quality, keeps the upload well under the limit.
  const addPhoto = async (file?: File | null) => {
    if (!file) return
    if (photos.length >= MAX_PHOTOS) { toast.warning(`Up to ${MAX_PHOTOS} photos`); return }
    if (!file.type.startsWith('image/')) { toast.error('Pick an image file'); return }
    if (file.size > 15_000_000) { toast.error('Photo too large (15MB max)'); return }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file)
      })
      const img = new Image()
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl })
      const MAX = 1600
      const scale = Math.min(1, MAX / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      const compressed = canvas.toDataURL('image/jpeg', 0.82)
      if (compressed.length * 0.75 > 5_000_000) { toast.error('Photo too large after compression'); return }
      setPhotos((prev) => [...prev, { dataUri: compressed, fileName: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg' }])
    } catch {
      toast.error('Could not read that photo')
    }
  }

  const handleSubmit = async () => {
    if (!form.clientId) { toast.warning('Please pick the client'); return }
    if (!form.incidentType) { toast.warning('Please pick what happened'); return }
    if (!form.incidentDate) { toast.warning('Please enter the date'); return }
    if (!form.description.trim()) { toast.warning('Please describe what happened'); return }
    setSubmitting(true)
    try {
      await incidentsApi('/caregiver-report', { method: 'POST', body: JSON.stringify({ ...form, photos }) })
      setSubmitted(true)
    } catch (e) {
      toast.error(`${errorMessage(e, 'Failed to submit.')} Please call the office directly.`)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) return (
    <div className="p-8 text-center">
      <div className="mb-4 text-5xl" aria-hidden="true">✅</div>
      <h3 className="mb-2 text-lg font-bold text-gray-900 dark:text-slate-100">Incident Reported</h3>
      <p className="mb-6 text-sm text-gray-700 dark:text-slate-300">The office has been notified and will follow up with you.</p>
      <p className="text-xs text-gray-600 dark:text-slate-400">If anyone is hurt or in danger, call 911 first, then call the office.</p>
      <button onClick={onClose} className="mt-4 rounded-xl bg-teal-700 px-6 py-3 text-base font-bold text-white hover:bg-teal-800 dark:bg-teal-700 dark:hover:bg-teal-800">Done</button>
    </div>
  )

  const canSubmit = !submitting && !!form.clientId && !!form.incidentType && !!form.incidentDate && !!form.description.trim()
  const big = `${FIELD} text-base`

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 text-center">
        <div className="mb-2 text-4xl" aria-hidden="true">⚠️</div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">Report an Incident</h3>
        <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">
          Falls, injuries, medication problems, missing property, or anything unsafe. Report it the same day.
        </p>
      </div>

      <div className="mb-4">
        <label className={LABEL}>Client *</label>
        <select className={big} value={form.clientId} onChange={(e) => set('clientId', e.target.value)}>
          <option value="">Select client...</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
        </select>
        {clientsError && <p className="mt-1 text-sm font-semibold text-red-700 dark:text-red-300">{clientsError}</p>}
      </div>

      <div className="mb-4">
        <label className={LABEL}>What happened? *</label>
        <select className={big} value={form.incidentType} onChange={(e) => set('incidentType', e.target.value)}>
          <option value="">Select type...</option>
          {INCIDENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <div className="mb-4 flex gap-3">
        <div className="flex-1">
          <label className={LABEL}>Date *</label>
          <input className={big} type="date" value={form.incidentDate} max={localToday()} onChange={(e) => set('incidentDate', e.target.value)} />
        </div>
        <div className="flex-1">
          <label className={LABEL}>Time</label>
          <input className={big} type="time" value={form.incidentTime} onChange={(e) => set('incidentTime', e.target.value)} />
        </div>
      </div>

      <div className="mb-4">
        <label className={LABEL}>Describe what happened *</label>
        <textarea className={big} rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Facts only: what you saw, heard, and did." />
      </div>
      <div className="mb-4">
        <label className={LABEL}>Injuries or damage</label>
        <textarea className={big} rows={2} value={form.injuriesOrDamage} onChange={(e) => set('injuriesOrDamage', e.target.value)} placeholder="Who was hurt, what was damaged or missing" />
      </div>
      <div className="mb-4">
        <label className={LABEL}>What you did about it</label>
        <textarea className={big} rows={2} value={form.actionsTaken} onChange={(e) => set('actionsTaken', e.target.value)} placeholder="Called 911, called family, helped the client up, etc." />
      </div>
      <div className="mb-4">
        <label className={LABEL}>Anyone else there?</label>
        <input className={big} type="text" value={form.witnesses} onChange={(e) => set('witnesses', e.target.value)} placeholder="Names of anyone who saw it" />
      </div>

      <div className="mb-5">
        <label className={LABEL}>Photos (optional, up to {MAX_PHOTOS})</label>
        {photos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {photos.map((ph, i) => (
              <div key={i} className="relative">
                <img src={ph.dataUri} alt={`Photo ${i + 1}`} className="h-[72px] w-[72px] rounded-lg border border-gray-200 object-cover dark:border-slate-600" />
                <button
                  type="button"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 h-[22px] w-[22px] rounded-full bg-red-700 text-xs text-white hover:bg-red-800 dark:bg-red-700 dark:hover:bg-red-800"
                >×</button>
              </div>
            ))}
          </div>
        )}
        {photos.length < MAX_PHOTOS && (
          <input className="text-sm text-gray-800 dark:text-slate-200" type="file" accept="image/*" capture="environment"
            onChange={(e) => { addPhoto(e.target.files?.[0]); e.target.value = '' }} />
        )}
      </div>

      <div className="mb-5 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
        <p className="text-sm font-semibold text-red-800 dark:text-red-200">
          ⚠️ If anyone is hurt or in danger, call 911 first. This report notifies the office right away.
        </p>
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onClose}
          className="flex-1 rounded-xl border-2 border-gray-300 bg-white py-3 text-base font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700">
          Cancel
        </button>
        <button type="button" onClick={handleSubmit} disabled={!canSubmit}
          className="flex-[2] rounded-xl bg-red-700 py-3 text-base font-bold text-white hover:bg-red-800 disabled:opacity-60 dark:bg-red-700 dark:hover:bg-red-800">
          {submitting ? 'Submitting...' : '⚠️ Submit Incident Report'}
        </button>
      </div>
    </div>
  )
}

export default IncidentReportForm
