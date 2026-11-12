// CALL RECORDING on the Call Tracking page (CallRail's call recording, on the numbers Twomiah sells; server crm/comms/calltracking.ts):
//   · RecordingPlayer — a call's recording, played through the app (GET /api/calltracking/calls/:id/recording; the audio is fetched
//     when asked for, never linked to Twilio), and deleted by whoever may change calls;
//   · RecordingSettings — on or off, the notice the caller hears first, and how long a recording is kept (integrations:update).
import { useEffect, useRef, useState } from 'react'
import { Play, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { PageError, errorText, useConfirm, usePermissions, useToast } from '../../shared'

export function RecordingPlayer({ callId, seconds, onDeleted }: { callId: string; seconds: number | null; onDeleted: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const url = useRef<string | null>(null)
  const confirm = useConfirm()
  const toast = useToast()
  const { known, can } = usePermissions()
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current) }, [])

  const play = async () => {
    setLoading(true); setError('')
    try {
      const res: Response = await api.raw(`/api/calltracking/calls/${callId}/recording`)
      if (!res.ok) throw new Error()
      url.current = URL.createObjectURL(await res.blob())
      setSrc(url.current)
    } catch { setError('The recording could not be played. Try again in a minute.') } finally { setLoading(false) }
  }
  const remove = async () => {
    if (!(await confirm('Delete this recording? It cannot be brought back.', { title: 'Delete recording', confirmText: 'Delete' }))) return
    try {
      await api.delete(`/api/calltracking/calls/${callId}/recording`)
      toast.success('Recording deleted')
      onDeleted()
    } catch (e) { setError(errorText(e, 'The recording could not be deleted')) }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {src ? <audio controls autoPlay src={src} className="h-8 w-56" aria-label="Call recording" /> : (
        <button type="button" onClick={play} disabled={loading} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-gray-100 dark:text-brand-200 dark:hover:bg-slate-800">
          <Play className="h-4 w-4" /> {loading ? 'Loading…' : `Play${seconds ? ` (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')})` : ''}`}
        </button>
      )}
      {known && can('calltracking:update') && (
        <button type="button" onClick={remove} aria-label="Delete recording" className="inline-flex items-center gap-1 px-2 text-xs text-red-700 hover:underline dark:text-red-300"><Trash2 className="h-3 w-3" /> Delete</button>
      )}
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  )
}

interface Settings { callRecording: boolean; callRecordingNotice: string; callRecordingKeepDays: number | null }
const KEEP = [{ v: '30', label: '30 days' }, { v: '90', label: '90 days' }, { v: '365', label: 'A year' }, { v: '', label: 'Until I delete them' }]

export function RecordingSettings() {
  const [s, setS] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
  useEffect(() => {
    api.get('/api/calltracking/settings').then((r: any) => setS({ callRecording: !!r.callRecording, callRecordingNotice: r.callRecordingNotice || '', callRecordingKeepDays: r.callRecordingKeepDays ?? null }))
      .catch((e) => setError(errorText(e, "Couldn't load the recording settings")))
  }, [])
  if (!s) return error ? <PageError message={error} /> : null

  const save = async () => {
    setSaving(true); setError('')
    try {
      const r: any = await api.put('/api/calltracking/settings', { callRecording: s.callRecording, callRecordingNotice: s.callRecordingNotice.trim() || null, callRecordingKeepDays: s.callRecordingKeepDays })
      setS({ callRecording: !!r.callRecording, callRecordingNotice: r.callRecordingNotice || '', callRecordingKeepDays: r.callRecordingKeepDays ?? null })
      toast.success('Recording settings saved')
    } catch (e) { setError(errorText(e, "Couldn't save the recording settings")) } finally { setSaving(false) }
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Call recording</h3>
        <p className="text-sm text-gray-600 dark:text-slate-400">Record the calls to your tracking numbers, and play them back on the call log. Each recorded minute costs about a quarter of a cent, from your wallet with the call.</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
        <input type="checkbox" checked={s.callRecording} onChange={(e) => setS({ ...s, callRecording: e.target.checked })} /> Record calls to my tracking numbers
      </label>
      <div>
        <label className="label" htmlFor="rec-notice">What the caller hears first</label>
        <textarea id="rec-notice" className="input" rows={2} maxLength={300} value={s.callRecordingNotice} onChange={(e) => setS({ ...s, callRecordingNotice: e.target.value })} />
        <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">Some states require everyone on a call to be told it is recorded. The caller always hears this before the call rings through.</p>
      </div>
      <label className="block text-sm text-gray-900 dark:text-slate-100">Keep recordings for{' '}
        <select className="input ml-1 w-auto" value={s.callRecordingKeepDays == null ? '' : String(s.callRecordingKeepDays)} onChange={(e) => setS({ ...s, callRecordingKeepDays: e.target.value ? Number(e.target.value) : null })}>
          {KEEP.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
        </select>
      </label>
      <PageError message={error} />
      <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
  )
}
