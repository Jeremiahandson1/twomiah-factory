// What the crew recorded on a visit, on the office's job page (landscaping re-check 11/08: the materials and the note the crew entered in
// the field view showed to the customer but not here — "Parts and materials used: Nothing recorded yet", "No notes yet").
//   materials  GET /api/crew-day/visits/:id/materials   (visit_materials)
//   time       GET /api/crew-day/visits/:id/crew        (crew_timers)
//   the note   GET /api/visit-reports/job/:id           (visit_reports)
import { useEffect, useState } from 'react'
import { HardHat } from 'lucide-react'
import { api } from '../../../api'
import { useAuth } from '../../../shared'

const rows = (r: any) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [])

export default function CrewWorkPanel({ jobId }: { jobId: string }) {
  const { hasFeature } = useAuth()
  const [materials, setMaterials] = useState<any[]>([])
  const [crew, setCrew] = useState<any[]>([])
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!jobId) return
    if (hasFeature('visit_materials')) api.get(`/api/crew-day/visits/${jobId}/materials`).then((r: any) => setMaterials(rows(r))).catch(() => setMaterials([]))
    if (hasFeature('crew_timers')) api.get(`/api/crew-day/visits/${jobId}/crew`).then((r: any) => setCrew(rows(r).filter((p: any) => Number(p.hours) > 0 || p.running))).catch(() => setCrew([]))
    if (hasFeature('visit_reports')) api.get(`/api/visit-reports/job/${jobId}`).then((r: any) => setNote(r?.note || null)).catch(() => setNote(null))
  }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!materials.length && !crew.length && !note) return null
  return (
    <section aria-label="From the crew" className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold"><HardHat className="h-5 w-5" aria-hidden />From the crew</h2>
      {note && <p className="mb-2 whitespace-pre-wrap"><span className="font-medium">Note to the customer:</span> {note}</p>}
      {materials.length > 0 && (
        <div className="mb-2"><p className="font-medium">Materials used</p>
          <ul className="list-disc pl-5">{materials.map((m) => <li key={m.id}>{m.quantity} {m.unit || ''} {m.name}</li>)}</ul>
        </div>
      )}
      {crew.length > 0 && (
        <div><p className="font-medium">Time on the visit</p>
          <ul className="list-disc pl-5">{crew.map((p) => <li key={p.key}>{p.name}: {Math.round(Number(p.hours) * 100) / 100} h{p.running ? ' (running)' : ''}</li>)}</ul>
        </div>
      )}
    </section>
  )
}
