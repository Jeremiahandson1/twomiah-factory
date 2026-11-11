// Settings › Skills (server crm/field/skillRoutes.ts, /api/skills; the rule is server/data/skills.ts): what each person can do and
// what each kind of job needs. A job given to people without a skill its kind needs asks "check before you book"; Find a time
// offers only people who have them all.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Plus, Wrench, X } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

interface Person { personId: string; kind: 'user' | 'member'; name: string; skills: string[] }
interface Data { people: Person[]; jobTypes: Array<{ jobType: string; skills: string[] }>; jobTypesInUse: string[]; skills: string[]; maxSkills: number; maxSkill: number }
type Row = { jobType: string; skills: string }

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const hint = 'mt-1 text-xs text-gray-600 dark:text-slate-300'
const button = 'inline-flex items-center gap-2 rounded-lg bg-orange-700 px-4 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60 dark:hover:bg-orange-600'
/** "Gas, Install" → ["Gas", "Install"]: the server trims, drops blanks and repeats. */
const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

export default function SkillsPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('jobs:dispatch')
  const [data, setData] = useState<Data | null>(null)
  const [people, setPeople] = useState<Record<string, string>>({})
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState('')
  const [loadError, setLoadError] = useState('')

  const load = () => api.get('/api/skills')
    .then((d: Data) => {
      setData(d)
      setPeople(Object.fromEntries(d.people.map((p) => [p.personId, p.skills.join(', ')])))
      setRows(d.jobTypes.length ? d.jobTypes.map((t) => ({ jobType: t.jobType, skills: t.skills.join(', ') })) : [{ jobType: '', skills: '' }])
    })
    .catch((e: Error) => setLoadError(e.message || 'The skills could not be loaded.'))
  useEffect(() => { load() }, [])

  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (!data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const savePerson = async (p: Person) => {
    setSaving(p.personId)
    try {
      const r: { skills: string[] } = await api.put(`/api/skills/people/${encodeURIComponent(p.personId)}`, { skills: split(people[p.personId] || '') })
      setPeople({ ...people, [p.personId]: r.skills.join(', ') })
      setData({ ...data, people: data.people.map((x) => (x.personId === p.personId ? { ...x, skills: r.skills } : x)) })
      toast.success(`Skills saved for ${p.name}`)
    } catch (e: any) {
      toast.error(e?.message || 'The skills could not be saved.')
    } finally { setSaving('') }
  }

  const saveJobTypes = async () => {
    setSaving('job-types')
    try {
      const r: { jobTypes: Data['jobTypes'] } = await api.put('/api/skills/job-types', { jobTypes: rows.filter((x) => x.jobType.trim()).map((x) => ({ jobType: x.jobType, skills: split(x.skills) })) })
      setRows(r.jobTypes.length ? r.jobTypes.map((t) => ({ jobType: t.jobType, skills: t.skills.join(', ') })) : [{ jobType: '', skills: '' }])
      toast.success('Job skills saved')
    } catch (e: any) {
      toast.error(e?.message || 'The job skills could not be saved.')
    } finally { setSaving('') }
  }

  const changed = (p: Person) => split(people[p.personId] || '').join('|') !== p.skills.join('|')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><Wrench className="h-6 w-6 text-orange-600 dark:text-orange-300" aria-hidden="true" /> Skills</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">
          Say what each person can do and what each kind of job needs. When a job goes to people who don&rsquo;t have a skill its kind needs,
          you&rsquo;re asked to check before you book, and can book anyway. A crew counts together: one person with the skill is enough.
          Find a time offers only people who have every skill the job needs.
        </p>
      </div>

      {!mayEdit && <p className="text-sm text-gray-700 dark:text-slate-300">You can see the skills. Only someone who schedules work can change them.</p>}

      <datalist id="skill-names">{data.skills.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="job-type-names">{data.jobTypesInUse.map((s) => <option key={s} value={s} />)}</datalist>

      <section className={box} aria-label="What each kind of job needs">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">What each kind of job needs</h2>
        <p className={hint}>The kind of job is the job&rsquo;s type, as you write it on the job. Separate skills with commas, like Gas, Install. A kind with no skills needs nothing.</p>
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <input aria-label={`Kind of job ${i + 1}`} list="job-type-names" maxLength={40} placeholder="Kind of job" className={`${input} sm:w-56`} value={r.jobType} disabled={!mayEdit}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, jobType: e.target.value } : x)))} />
              <input aria-label={`Skills kind of job ${i + 1} needs`} placeholder="Skills it needs" className={input} value={r.skills} disabled={!mayEdit}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, skills: e.target.value } : x)))} />
              {mayEdit && <button type="button" aria-label={`Remove kind of job ${i + 1}`} onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ jobType: '', skills: '' }])} className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>}
            </div>
          ))}
        </div>
        {mayEdit && (
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => setRows([...rows, { jobType: '', skills: '' }])} className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-200"><Plus className="h-4 w-4" />Add a kind of job</button>
            <button type="button" onClick={saveJobTypes} disabled={saving === 'job-types'} className={button}>{saving === 'job-types' && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
          </div>
        )}
      </section>

      <section className={box} aria-label="What each person can do">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">What each person can do</h2>
        <p className={hint}>Everyone who can be given work. Separate skills with commas; up to {data.maxSkills} each.</p>
        {data.people.length === 0 && <p className="mt-3 text-sm text-gray-700 dark:text-slate-300">No one can be given work yet. Add people in Settings › Users or on your team.</p>}
        <ul className="mt-3 divide-y divide-gray-200 dark:divide-slate-700">
          {data.people.map((p) => (
            <li key={p.personId} className="flex flex-wrap items-center gap-2 py-2 sm:flex-nowrap">
              <span className="w-full text-sm font-medium text-gray-900 sm:w-48 sm:shrink-0 dark:text-slate-100">{p.name}</span>
              <input aria-label={`${p.name}'s skills`} list="skill-names" placeholder="No skills yet" className={input} value={people[p.personId] ?? ''} disabled={!mayEdit}
                onChange={(e) => setPeople({ ...people, [p.personId]: e.target.value })} />
              {mayEdit && <button type="button" onClick={() => savePerson(p)} disabled={saving === p.personId || !changed(p)} className={button}>{saving === p.personId && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
