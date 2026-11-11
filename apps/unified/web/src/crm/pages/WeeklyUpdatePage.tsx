// Settings › Weekly Client Update (server crm/clientUpdates/weeklyUpdate.ts, /api/weekly-update): when the weekly email goes, and
// every update sent lately with whether the client opened it. Every word here is what the pass does.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Newspaper } from 'lucide-react'
import { momentDate, whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

interface Settings { enabled: boolean; weekday: number; hour: number }
interface Sent { id: string; client: string; sentTo: string | null; sentAt: string; status: string; openedAt: string | null; problem: string | null }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const hourWords = (h: number) => (h === 0 ? 'midnight' : h === 12 ? 'noon' : `${h % 12}${h < 12 ? 'am' : 'pm'}`)
const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const select = 'mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const label = 'block text-sm font-medium text-gray-800 dark:text-slate-200'

export default function WeeklyUpdatePage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('company:update')
  const [form, setForm] = useState<Settings | null>(null)
  const [sent, setSent] = useState<Sent[]>([])
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    api.get('/api/weekly-update')
      .then((r: { settings: Settings; sent: Sent[] }) => { setForm(r.settings); setSent(r.sent) })
      .catch((e: Error) => setLoadError(e.message || 'The weekly update settings could not be loaded.'))
  }, [])

  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (!form) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const save = async () => {
    setSaving(true)
    try {
      const r: { settings: Settings } = await api.put('/api/weekly-update/settings', form)
      setForm(r.settings)
      toast.success('Weekly update saved')
    } catch (e: any) {
      toast.error(e?.message || 'The weekly update could not be saved.')
    } finally { setSaving(false) }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><Newspaper className="h-6 w-6 text-orange-600 dark:text-orange-300" aria-hidden="true" /> Weekly Client Update</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">
          Once a week, each client with something new in their portal gets one email listing it — daily logs, photos, files, reports and
          messages from the past seven days — with a button to their portal. A client with nothing new that week gets nothing. Only
          clients whose portal is on and who have an email address are sent one; anyone who unsubscribed is never emailed.
        </p>
      </div>

      {!mayEdit && <p className="text-sm text-gray-700 dark:text-slate-300">You can see these settings. Only an owner or admin can change them.</p>}

      <section className={box} aria-label="When it goes">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
          <input type="checkbox" checked={form.enabled} disabled={!mayEdit} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4" />
          Send the weekly update
        </label>
        <div className="mt-4 flex flex-wrap gap-4">
          <div>
            <label htmlFor="wu-day" className={label}>Day</label>
            <select id="wu-day" className={select} value={form.weekday} disabled={!mayEdit} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="wu-hour" className={label}>From</label>
            <select id="wu-hour" className={select} value={form.hour} disabled={!mayEdit} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourWords(h)}</option>)}
            </select>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-600 dark:text-slate-300">On your business&rsquo;s clock (the time zone in Settings › Company). It goes within the hour after the time you pick.</p>
        {mayEdit && (
          <button type="button" onClick={save} disabled={saving} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-700 px-4 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60 dark:hover:bg-orange-600">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save
          </button>
        )}
      </section>

      <section className={box} aria-label="Updates sent">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Updates sent</h2>
        {sent.length === 0
          ? <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">None yet.</p>
          : (
            <table className="mt-3 w-full text-left text-sm">
              <thead><tr className="text-gray-600 dark:text-slate-300"><th className="py-1 font-medium">Client</th><th className="py-1 font-medium">Sent</th><th className="py-1 font-medium">Opened</th></tr></thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {sent.map((s) => (
                  <tr key={s.id} className="text-gray-900 dark:text-slate-100">
                    <td className="py-2">{s.client}{s.sentTo && <span className="block text-xs text-gray-600 dark:text-slate-400">{s.sentTo}</span>}</td>
                    <td className="py-2">{momentDate(s.sentAt, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="py-2">{s.status === 'failed' ? <span className="text-red-700 dark:text-red-300">Not sent{s.problem ? `: ${s.problem}` : ''}</span> : s.openedAt ? whenDateTime(s.openedAt) : 'Not yet'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </div>
  )
}
