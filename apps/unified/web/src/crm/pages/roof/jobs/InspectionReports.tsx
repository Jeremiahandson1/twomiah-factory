// A job's inspection reports (docs/parity/roof-inspection-report.md; roofing depth gap 6), on the job page behind the
// `inspection_reports` switch — the same switch and the same permissions as /api/inspection-reports:
//   · building one from the job's damage and before photos (jobs:update), then naming its sections, notes and photos;
//   · the PDF (jobs:read), and the private link a homeowner or adjuster opens — on, copied, renewed, given a last day or
//     switched off (portal:share, which a field seat does not hold, so those controls are not drawn for it);
//   · deleting one (jobs:delete).
import { useCallback, useEffect, useState } from 'react'
import { FileText, Link2, Copy, Download, Trash2, Plus, X } from 'lucide-react'
import { api } from '../../../../api'
import { useConfirm, useMayWrite, useToast, errorText } from '../../../../shared'
import { downloadFile } from '@twomiah/tenant-ui/src/invoicing/ui'
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'

export interface ReportPhotoChoice { id: string; url?: string | null; thumbnailUrl?: string | null; caption?: string | null; photoType?: string | null; sourcePhotoId?: string | null }
interface Section { title: string; notes: string; photoIds: string[] }
interface Link { token: string; path: string; url: string; expiresAt: string | null; expired: boolean }
interface Row { id: string; title: string; photoCount: number; linkOn: boolean; sharedWithCustomer: boolean; updatedAt: string }
interface Full { id: string; title: string; intro: string; sections: Array<{ title: string; notes: string; photos: Array<{ id: string }> }>; link: Link | null; sharedWithCustomer: boolean; job: { number: string } }

const field = 'w-full text-sm border rounded-lg px-3 py-2 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100'
const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 disabled:opacity-50'
const btnPrimary = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50'

/** The link as a person can paste it: the server's address when it has one, else this page's own origin. */
const fullUrl = (l: Link) => (/^https?:\/\//.test(l.url) ? l.url : `${window.location.origin}${l.path}`)

export default function InspectionReports({ jobId, photos }: { jobId: string; photos: ReportPhotoChoice[] }) {
  const toast = useToast()
  const confirm = useConfirm()
  const mayBuild = useMayWrite('jobs:update')
  const mayDelete = useMayWrite('jobs:delete')
  const mayShare = useMayWrite('portal:share')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Full | null>(null)
  const [draft, setDraft] = useState<{ title: string; intro: string; sections: Section[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastDay, setLastDay] = useState('')

  const load = useCallback(async () => {
    try { setRows(((await api.get(`/api/inspection-reports?jobId=${jobId}`)) as { data: Row[] }).data || []) } catch { /* the card says nothing rather than something wrong */ } finally { setLoading(false) }
  }, [jobId])
  useEffect(() => { load() }, [load])

  const edit = async (id: string) => {
    try {
      const full = (await api.get(`/api/inspection-reports/${id}`)) as Full
      setOpen(full)
      setDraft({ title: full.title, intro: full.intro || '', sections: full.sections.map((s) => ({ title: s.title, notes: s.notes || '', photoIds: s.photos.map((p) => p.id) })) })
      setLastDay(full.link?.expiresAt ? full.link.expiresAt.slice(0, 10) : '')
    } catch (e) { toast.error(errorText(e, 'Could not open the report')) }
  }
  const build = async () => {
    setBusy(true)
    try { const made = (await api.post('/api/inspection-reports', { jobId })) as Full; await load(); await edit(made.id); toast.success('Report built from the job’s damage and before photos') } catch (e) { toast.error(errorText(e, 'Could not build the report')) } finally { setBusy(false) }
  }
  const save = async () => {
    if (!open || !draft) return
    setBusy(true)
    try {
      const saved = (await api.put(`/api/inspection-reports/${open.id}`, draft)) as Full
      setOpen(saved); await load(); toast.success('Report saved')
    } catch (e) { toast.error(errorText(e, 'Could not save the report')) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!open || !(await confirm('Its link stops working.', { title: 'Delete this report?', confirmText: 'Delete report' }))) return
    setBusy(true)
    try { await api.delete(`/api/inspection-reports/${open.id}`); setOpen(null); setDraft(null); await load() } catch (e) { toast.error(errorText(e, 'Could not delete the report')) } finally { setBusy(false) }
  }
  const link = async (body: Record<string, unknown>) => {
    if (!open) return
    setBusy(true)
    try { const r = (await api.post(`/api/inspection-reports/${open.id}/link`, body)) as { link: Link }; setOpen({ ...open, link: r.link }); await load() } catch (e) { toast.error(errorText(e, 'Could not change the link')) } finally { setBusy(false) }
  }
  const linkOff = async () => {
    if (!open) return
    setBusy(true)
    try { await api.delete(`/api/inspection-reports/${open.id}/link`); setOpen({ ...open, link: null }); setLastDay(''); await load() } catch (e) { toast.error(errorText(e, 'Could not switch the link off')) } finally { setBusy(false) }
  }
  const copy = async (l: Link) => { try { await navigator.clipboard.writeText(fullUrl(l)); toast.success('Link copied') } catch { toast.error('Could not copy — select the link and copy it') } }
  const pdf = async (id: string, number: string) => { try { await downloadFile(`/api/inspection-reports/${id}/pdf`, `inspection-report-${number || 'job'}.pdf`) } catch (e) { toast.error(errorText(e, 'Could not download the PDF')) } }

  const setSection = (i: number, patch: Partial<Section>) => setDraft((d) => d && ({ ...d, sections: d.sections.map((s, k) => (k === i ? { ...s, ...patch } : s)) }))
  /** A photo is in one section: choosing it here takes it out of any other. */
  const toggle = (i: number, photoId: string) => setDraft((d) => d && ({
    ...d,
    sections: d.sections.map((s, k) => (k === i
      ? { ...s, photoIds: s.photoIds.includes(photoId) ? s.photoIds.filter((x) => x !== photoId) : [...s.photoIds, photoId] }
      : { ...s, photoIds: s.photoIds.filter((x) => x !== photoId) })),
  }))

  if (loading) return null
  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900" data-testid="inspection-reports">
      <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
        <FileText className="w-4 h-4 text-gray-400" /> Inspection report
      </h2>
      {rows.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400 mb-3">No report yet. Build one from this job’s damage and before photos, then send the homeowner or the adjuster a private link or the PDF.</p>}
      <ul className="space-y-2 mb-3">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
            <button type="button" onClick={() => edit(r.id)} className="text-left font-medium text-orange-700 hover:underline dark:text-orange-300">{r.title}</button>
            <span className="text-xs text-gray-500 dark:text-slate-400 shrink-0">{r.photoCount} photo{r.photoCount === 1 ? '' : 's'}{r.linkOn ? ' · link on' : ''}</span>
          </li>
        ))}
      </ul>
      {mayBuild && <button type="button" onClick={build} disabled={busy} className={btnPrimary}><Plus className="w-4 h-4" /> Build report from photos</button>}

      {open && draft && (
        <div className="mt-5 border-t pt-5 space-y-4 dark:border-slate-700">
          <div>
            <label htmlFor="rep-title" className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">Title</label>
            <input id="rep-title" className={field} value={draft.title} maxLength={120} disabled={!mayBuild} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div>
            <label htmlFor="rep-intro" className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">Introduction</label>
            <textarea id="rep-intro" className={field} rows={3} maxLength={4000} value={draft.intro} disabled={!mayBuild} placeholder="What was inspected, and how." onChange={(e) => setDraft({ ...draft, intro: e.target.value })} />
          </div>
          {draft.sections.map((s, i) => (
            <fieldset key={i} className="border rounded-lg p-3 dark:border-slate-700">
              <div className="flex gap-2 mb-2">
                <input aria-label={`Section ${i + 1} title`} className={field} value={s.title} maxLength={80} disabled={!mayBuild} placeholder="Roof section, e.g. North slope" onChange={(e) => setSection(i, { title: e.target.value })} />
                {mayBuild && <button type="button" aria-label={`Remove section ${i + 1}`} className={btn} onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_, k) => k !== i) })}><X className="w-4 h-4" /></button>}
              </div>
              <textarea aria-label={`Section ${i + 1} notes`} className={`${field} mb-2`} rows={2} maxLength={2000} value={s.notes} disabled={!mayBuild} placeholder="What the photos show" onChange={(e) => setSection(i, { notes: e.target.value })} />
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {photos.map((p) => {
                  const on = s.photoIds.includes(p.id)
                  return (
                    <button key={p.id} type="button" disabled={!mayBuild} aria-pressed={on} aria-label={`${on ? 'Remove' : 'Add'} ${p.sourcePhotoId ? 'marked copy of ' : ''}${p.caption || `${p.photoType || 'general'} photo`} ${on ? 'from' : 'to'} ${s.title || 'this section'}`}
                      onClick={() => toggle(i, p.id)} className={`relative aspect-square rounded-md overflow-hidden border-2 ${on ? 'border-orange-600' : 'border-transparent opacity-60'}`}>
                      <img src={p.thumbnailUrl || p.url || ''} alt="" className="w-full h-full object-cover" />
                      {p.sourcePhotoId && <span className="absolute left-0.5 top-0.5 rounded bg-orange-600 px-1 text-[9px] font-semibold text-white">Marked</span>}
                    </button>
                  )
                })}
                {photos.length === 0 && <p className="text-xs text-gray-500 col-span-full dark:text-slate-400">This job has no photos yet.</p>}
              </div>
            </fieldset>
          ))}
          {mayBuild && draft.sections.length < 20 && <button type="button" className={btn} onClick={() => setDraft({ ...draft, sections: [...draft.sections, { title: '', notes: '', photoIds: [] }] })}><Plus className="w-4 h-4" /> Add a section</button>}

          <div className="flex flex-wrap gap-2">
            {mayBuild && <button type="button" onClick={save} disabled={busy} className={btnPrimary}>Save report</button>}
            <button type="button" onClick={() => pdf(open.id, open.job?.number)} className={btn}><Download className="w-4 h-4" /> PDF</button>
            {mayDelete && <button type="button" onClick={remove} disabled={busy} className={btn}><Trash2 className="w-4 h-4" /> Delete</button>}
          </div>

          {/* The private link: the homeowner's or the adjuster's way in, no sign-in. portal:share only. */}
          {mayShare && (
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-800">
              <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5 dark:text-slate-100"><Link2 className="w-4 h-4" /> Private link</p>
              {!open.link ? (
                <div className="mt-2">
                  <p className="text-xs text-gray-600 mb-2 dark:text-slate-300">Off. Anyone with the link can read this report and download its PDF; nothing else of the job or the customer.</p>
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => link({})}>Switch the link on</button>
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <input readOnly aria-label="Private link" className={field} value={fullUrl(open.link)} onFocus={(e) => e.currentTarget.select()} />
                  <div className="flex flex-wrap gap-2 items-center">
                    <button type="button" className={btn} onClick={() => copy(open.link!)}><Copy className="w-4 h-4" /> Copy</button>
                    <a className={btn} href={`mailto:?subject=${encodeURIComponent(open.title)}&body=${encodeURIComponent(`Here is the inspection report:\n${fullUrl(open.link)}`)}`}>Email it</a>
                    <button type="button" className={btn} disabled={busy} onClick={() => link({ renew: true })}>New link</button>
                    <button type="button" className={btn} disabled={busy} onClick={linkOff}>Switch off</button>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <label htmlFor="rep-last-day" className="text-gray-600 dark:text-slate-300">Stops working after</label>
                    <input id="rep-last-day" type="date" className="text-sm border rounded-lg px-2 py-1 dark:bg-slate-900 dark:border-slate-700" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
                    <button type="button" className={btn} disabled={busy} onClick={() => link({ expiresAt: lastDay ? new Date(`${lastDay}T23:59:59`).toISOString() : null })}>Set</button>
                  </div>
                  {open.link.expiresAt && <p className="text-xs text-gray-500 dark:text-slate-400">{open.link.expired ? 'Ran out' : 'Works until'} {whenDateTime(open.link.expiresAt)}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
