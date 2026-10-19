// Moved from templates/crm-roof/frontend/src/pages/roofing/PipelineBoard.tsx — roofing's pipeline board, at /crm/pipeline
// and the roofer's /crm/dashboard.
//
// Changes from the template:
//   · the server's names: a job's `number` (was jobNumber), `address` (was propertyAddress), and its homeowner from
//     `contact.name` — the template read `contactName`, which no job reply ever carried, so the card never showed who the
//     job was for; the stages are the server's PIPELINE_STATUSES (./model.ts);
//   · a drop moves the job only onto the NEXT stage. POST /api/jobs/:id/advance takes no target — it steps one stage
//     forward, as the template's server did too — so the template's drop on any column sent { status } the server never
//     read: a job dropped three columns right moved one, and one dropped back onto Lead moved FORWARD. A drop elsewhere
//     now says where the job can go; the card shows the stage the server answered;
//   · a closed job (lost / cancelled) is off the board, as the close dialog promises; the template filed every status it
//     didn't draw under Lead, so a lost job came back as a lead;
//   · the Priority filter's "Normal" is "Medium": a job's priority is low / medium / high / urgent (the server's default
//     is medium), so "Normal" matched nothing;
//   · dropped: the claim-status dot (it read `job.claimStatus`, which is the insurance claim's, never on a job) and
//     `stageEnteredAt` (never on a job; the days-in-stage count falls back to the last update, as before);
//   · people from GET /api/company/users (the template's /api/users), asked of a seat the server answers (team:read or
//     users:read, the server's own gate); crews are GET /api/crews' { data }.
import { useState, useEffect, useCallback } from 'react'
import type { DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Filter, GripVertical, User, Users, Ruler, Clock, DollarSign, AlertTriangle, MapPin, Zap } from 'lucide-react'
import { api } from '../../../../api'
import { useAuth, useMayWrite, usePermissions, useToast, errorText } from '../../../../shared'
import { displayName } from '../lib/user'
import { PIPELINE_STATUSES, STAGE_LABELS, rowsOf } from './model'
import type { Crew, Person, RoofJob } from './model'

const STAGES: readonly string[] = PIPELINE_STATUSES

const STAGE_THRESHOLDS: Record<string, number> = {
  proposal_sent: 7,
  signed: 3,
  material_ordered: 5,
}

const JOB_TYPE_COLORS: Record<string, string> = {
  insurance: 'bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40',
  retail: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  commercial: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  new_construction: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  emergency: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
}

function daysInStage(job: RoofJob): number {
  const stageDate = job.updatedAt || job.createdAt
  if (!stageDate) return 0
  return Math.floor((Date.now() - new Date(stageDate).getTime()) / (1000 * 60 * 60 * 24))
}

function getInitials(name: string): string {
  if (!name) return ''
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

export default function PipelineBoard() {
  // Dragging a card posts /jobs/:id/advance — the same write as the Advance Stage button, so it answers the same
  // permission. A drag has no button to hide, so the card stops being draggable and the drop handler refuses. (T42)
  const mayMoveJob = useMayWrite('jobs:update')
  // The roster is GET /api/company/users — users:read or team:read on the server. Asked only of a seat it answers, and
  // only once the permission list is known (null until then). (T64)
  const { known, can } = usePermissions()
  const maySeeRoster: boolean | null = known ? (can('team:read') || can('users:read')) : null
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [jobs, setJobs] = useState<RoofJob[]>([])
  const [users, setUsers] = useState<Person[]>([])
  const [crews, setCrews] = useState<Crew[]>([])
  const [loading, setLoading] = useState(true)

  const [filterRep, setFilterRep] = useState('')
  const [filterCrew, setFilterCrew] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterCanvassing, setFilterCanvassing] = useState(false)
  // "My jobs" — cards where I'm the sales rep (owner's decision, T63)
  const [mineOnly, setMineOnly] = useState(false)

  const [dragJobId, setDragJobId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [jobsRes, usersRes, crewsRes] = await Promise.all([
        api.get('/api/jobs', { limit: 500 }),
        maySeeRoster ? api.get('/api/company/users') : Promise.resolve([]),
        api.get('/api/crews'),
      ])
      setJobs(rowsOf<RoofJob>(jobsRes))
      setUsers(rowsOf<Person>(usersRes))
      setCrews(rowsOf<Crew>(crewsRes))
    } catch {
      toast.error('Failed to load pipeline data')
    } finally {
      setLoading(false)
    }
  }, [maySeeRoster]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const filteredJobs = jobs.filter((j) => {
    if (filterRep && j.assignedSalesRepId !== filterRep) return false
    if (filterCrew && j.assignedCrewId !== filterCrew) return false
    if (mineOnly && j.assignedSalesRepId !== user?.id) return false
    if (filterType && j.jobType !== filterType) return false
    if (filterPriority && j.priority !== filterPriority) return false
    if (filterCanvassing && j.source !== 'canvassing') return false
    return true
  })

  const grouped: Record<string, RoofJob[]> = {}
  STAGES.forEach((s) => (grouped[s] = []))
  // A closed job (lost, cancelled) is not on the board; a job at any status this list doesn't know is shown under Lead,
  // as the template did, so it can't vanish.
  filteredJobs.forEach((j) => {
    if (j.status === 'lost' || j.status === 'cancelled') return
    const stage = j.status || 'lead'
    if (grouped[stage]) grouped[stage].push(j)
    else grouped['lead'].push(j)
  })

  const handleDragStart = (e: DragEvent, jobId: string) => {
    setDragJobId(jobId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', jobId)
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = async (e: DragEvent, targetStage: string) => {
    // A drop is a write. Refused here as well as making the card undraggable, because a drag can also start from
    // outside this list.
    if (!mayMoveJob) return
    e.preventDefault()
    const jobId = e.dataTransfer.getData('text/plain') || dragJobId
    if (!jobId) return
    setDragJobId(null)

    const job = jobs.find((j) => String(j.id) === String(jobId))
    if (!job || job.status === targetStage) return

    // Advance steps one stage forward; a drop anywhere else would not do what it shows.
    const at = STAGES.indexOf(job.status || 'lead')
    const next = at > -1 && at < STAGES.length - 1 ? STAGES[at + 1] : null
    if (targetStage !== next) {
      toast.error(next
        ? `A job moves one stage at a time — drop it on ${STAGE_LABELS[next]}.`
        : 'This job is at the last stage.')
      return
    }

    // Optimistic update
    setJobs((prev) => prev.map((j) => (String(j.id) === String(jobId) ? { ...j, status: targetStage, updatedAt: new Date().toISOString() } : j)))

    try {
      const updated = await api.post(`/api/jobs/${jobId}/advance`) as RoofJob
      setJobs((prev) => prev.map((j) => (String(j.id) === String(jobId) ? { ...j, ...updated, contact: j.contact } : j)))
      toast.success(`Moved to ${STAGE_LABELS[updated?.status] || STAGE_LABELS[targetStage]}`)
    } catch (err) {
      toast.error(errorText(err, 'Failed to advance job'))
      load()
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
      </div>
    )
  }

  const repMap: Record<string, string> = {}
  users.forEach((u) => (repMap[u.id] = displayName(u)))
  const crewMap: Record<string, string> = {}
  crews.forEach((c) => (crewMap[c.id] = c.name))

  return (
    <div className="h-full flex flex-col">
      {/* Filter Bar */}
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b flex-shrink-0 overflow-x-auto dark:bg-slate-900">
        <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <select
          value={filterRep}
          onChange={(e) => setFilterRep(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900"
        >
          <option value="">All Sales Reps</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{displayName(u)}</option>
          ))}
        </select>
        <select
          value={filterCrew}
          onChange={(e) => setFilterCrew(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900"
        >
          <option value="">All Crews</option>
          {crews.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900"
        >
          <option value="">All Types</option>
          <option value="insurance">Insurance</option>
          <option value="retail">Retail</option>
          <option value="commercial">Commercial</option>
          <option value="new_construction">New Construction</option>
          <option value="emergency">Emergency</option>
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900"
        >
          <option value="">All Priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <button type="button" onClick={() => setMineOnly(!mineOnly)} aria-pressed={mineOnly}
          className={`text-sm px-3 py-1.5 rounded-lg border font-medium ${mineOnly ? 'bg-orange-100 border-orange-300 text-orange-900 dark:bg-orange-950/40 dark:border-orange-700 dark:text-orange-200' : 'bg-white border-gray-300 text-gray-700 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-200'}`}>
          My jobs
        </button>
        <button
          onClick={() => setFilterCanvassing(!filterCanvassing)}
          className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border font-medium transition ${
            filterCanvassing ? 'bg-orange-100 border-orange-300 text-orange-700 dark:text-orange-200 dark:bg-orange-950/40' : 'bg-white border-gray-300 text-gray-600 dark:text-slate-300 dark:bg-slate-800'
          } dark:bg-slate-900`}
        >
          <MapPin className="w-3.5 h-3.5" />
          Canvassing
        </button>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 p-4 h-full" style={{ minWidth: STAGES.length * 280 }}>
          {STAGES.map((stage) => {
            const stageJobs = grouped[stage] || []
            return (
              <div
                key={stage}
                className="flex flex-col bg-gray-100 rounded-xl min-w-[260px] w-[260px] flex-shrink-0 dark:bg-slate-800"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage)}
              >
                {/* Column Header */}
                <div className="px-3 py-3 flex items-center justify-between flex-shrink-0">
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider truncate dark:text-slate-400">
                    {STAGE_LABELS[stage]}
                  </h3>
                  <span className="text-xs font-bold bg-gray-200 text-gray-600 rounded-full px-2 py-0.5 ml-2 flex-shrink-0 dark:text-slate-300 dark:bg-slate-700">
                    {stageJobs.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                  {stageJobs.map((job) => {
                    const days = daysInStage(job)
                    const threshold = STAGE_THRESHOLDS[stage]
                    const overdue = !!threshold && days > threshold
                    const typeColor = JOB_TYPE_COLORS[job.jobType || ''] || 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800'

                    return (
                      <div
                        key={job.id}
                        draggable={mayMoveJob}
                        onDragStart={(e) => handleDragStart(e, String(job.id))}
                        onClick={() => navigate(`/crm/jobs/${job.id}`)}
                        className="bg-white rounded-lg p-3 shadow-sm border border-gray-200 cursor-pointer hover:shadow-md transition-shadow group dark:bg-slate-900 dark:border-slate-700"
                      >
                        <div className="flex items-start justify-between mb-1.5">
                          <span className="text-xs font-mono font-semibold text-gray-500 dark:text-slate-400">
                            {job.number || '—'}
                          </span>
                          <GripVertical className="w-3.5 h-3.5 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>

                        {job.contact?.name && (
                          <p className="text-sm font-medium text-gray-900 truncate dark:text-slate-100">{job.contact.name}</p>
                        )}
                        {job.address && (
                          <p className="text-xs text-gray-500 truncate mt-0.5 dark:text-slate-400">
                            {job.address.slice(0, 40)}
                          </p>
                        )}

                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          {job.jobType === 'insurance' ? (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40">
                              INS
                            </span>
                          ) : (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${typeColor}`}>
                              {(job.jobType || 'retail').replace('_', ' ')}
                            </span>
                          )}

                          {job.assignedSalesRepId && repMap[job.assignedSalesRepId] && (
                            <span className="flex items-center gap-0.5 text-[10px] text-gray-500 dark:text-slate-400">
                              <User className="w-3 h-3" />
                              {getInitials(repMap[job.assignedSalesRepId])}
                            </span>
                          )}

                          {job.assignedCrewId && crewMap[job.assignedCrewId] && (
                            <span className="flex items-center gap-0.5 text-[10px] text-gray-500 dark:text-slate-400">
                              <Users className="w-3 h-3" />
                              {crewMap[job.assignedCrewId]}
                            </span>
                          )}

                          {!!job.totalSquares && (
                            <span className="flex items-center gap-0.5 text-[10px] text-gray-500 dark:text-slate-400">
                              <Ruler className="w-3 h-3" />
                              {job.totalSquares} sq
                            </span>
                          )}

                          {job.source === 'canvassing' && (
                            <span className="flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                              <MapPin className="w-3 h-3" />
                              canvass
                            </span>
                          )}

                          {job.source === 'storm' && (
                            <span className="flex items-center gap-0.5 text-[10px] text-amber-700 font-medium dark:text-amber-300">
                              <Zap className="w-3 h-3" />
                              storm
                            </span>
                          )}
                        </div>

                        {/* Canvassing storm event name from notes. blue-600, not blue-500: #3b82f6 on white is 3.68:1
                            for a 10px label. (T58d) */}
                        {job.source === 'canvassing' && job.notes && job.notes.startsWith('Canvassing lead') && (
                          <p className="text-[10px] text-blue-600 truncate mt-0.5 dark:text-blue-300">
                            {job.notes.split('—')[1]?.trim() || ''}
                          </p>
                        )}

                        {/* Insurance-specific: RCV (invoices:read — absent otherwise) + days since loss */}
                        {job.jobType === 'insurance' && (
                          <div className="flex items-center gap-2 mt-1">
                            {!!job.rcv && (
                              <span className="flex items-center gap-0.5 text-[10px] text-green-700 font-medium dark:text-green-300">
                                <DollarSign className="w-3 h-3" />
                                {Number(job.rcv).toLocaleString()} RCV
                              </span>
                            )}
                            {job.dateOfLoss && (() => {
                              const daysSinceLoss = Math.floor((Date.now() - new Date(job.dateOfLoss).getTime()) / (1000 * 60 * 60 * 24))
                              return daysSinceLoss > 45 ? (
                                <span className="flex items-center gap-0.5 text-[10px] text-red-600 font-semibold dark:text-red-400">
                                  <AlertTriangle className="w-3 h-3" />
                                  {daysSinceLoss}d loss
                                </span>
                              ) : null
                            })()}
                          </div>
                        )}

                        <div className="flex items-center gap-1 mt-1.5">
                          <Clock className="w-3 h-3 text-gray-400" />
                          <span className={`text-[10px] ${overdue ? 'text-red-600 font-semibold dark:text-red-400' : 'text-gray-500 dark:text-slate-400'}`}>
                            {days}d in stage
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
