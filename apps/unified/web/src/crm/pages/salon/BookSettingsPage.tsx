// Settings › The Book (server crm/salon/appointments.ts /api/appointments/book-settings; owner's decision 2026-10-25):
// the owner's one switch for who sees which chairs. Off — the default — every seat sees the whole book, as salons
// expect; on, a stylist sees and works only their own appointments (Square Appointments, Vagaro and Boulevard offer the
// same). The server applies it on every read and write; this page only says what it does and flips it.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Loader2 } from 'lucide-react'
import { api } from '../../../api'
import { useToast, usePermissions } from '../../../shared'
import { roleWord } from '../../viewAs'
import type { BookScope } from './bookScope'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-sm text-gray-600 dark:text-slate-300'

export default function BookSettingsPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  // Who may flip it is who may change the company — the server asks the same (company:update).
  const mayEdit = known && can('company:update')
  const [on, setOn] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  // The rungs in this salon's own words (Stylist, Front Desk), as the Users list says them.
  const stylist = roleWord('field') || 'Stylist'
  const desk = roleWord('viewer') || 'Front Desk'

  useEffect(() => {
    api.get('/api/appointments/book-settings')
      .then((r: BookScope) => setOn(!!r?.stylistsSeeOwnBookOnly))
      .catch((e: Error) => setLoadError(e.message || 'The book settings could not be loaded.'))
  }, [])

  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (on === null) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const flip = async (next: boolean) => {
    setSaving(true)
    try {
      const r: BookScope = await api.put('/api/appointments/book-settings', { stylistsSeeOwnBookOnly: next })
      setOn(!!r?.stylistsSeeOwnBookOnly)
      toast.success(next ? `Each ${stylist.toLowerCase()} now sees only their own appointments` : 'Everyone now sees the whole book')
    } catch (e: any) {
      toast.error(e?.message || 'The setting could not be saved.')
    } finally { setSaving(false) }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><Calendar className="h-6 w-6 text-teal-700 dark:text-teal-300" aria-hidden="true" /> The Book</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">Who sees which chairs in The Book.</p>
      </div>

      {!mayEdit && <p className="text-sm text-gray-700 dark:text-slate-300">You can see this setting. Only an owner or admin can change it.</p>}

      <section className={box} aria-label="Who sees which appointments">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
          <input type="checkbox" checked={on} disabled={!mayEdit || saving} onChange={(e) => flip(e.target.checked)} className="h-4 w-4" />
          {stylist}s see only their own appointments
          {saving && <Loader2 className="h-4 w-4 animate-spin text-gray-500 dark:text-slate-300" aria-hidden="true" />}
        </label>
        <p className={hint}>
          Off by default: everyone who opens The Book sees every chair.
        </p>
        <p className={hint}>
          On: a {stylist.toLowerCase()} sees, books, moves, checks in and completes only the appointments in their own chair — in The Book (day and
          week), on the dashboard and on a client&rsquo;s Appointments tab. Clients&rsquo; visit history and formulas stay whole, so the
          next {stylist.toLowerCase()} can repeat a colour. {desk}, managers, admins and the owner always see the whole book.
        </p>
      </section>
    </div>
  )
}
