// Portal projects: list + detail with recent work and a link to the project file room.
import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { FolderKanban, MapPin, Calendar, ArrowRight } from 'lucide-react'
import { usePortal } from './PortalContext'
import { PLink, Spinner, PageTitle, Empty, Section, card, pill, btnSecondary, formatDate } from './common'

const STATUS_STYLES: Record<string, string> = { planning: 'bg-gray-100 text-gray-700', active: 'bg-green-100 text-green-700', on_hold: 'bg-yellow-100 text-yellow-700', completed: 'bg-blue-100 text-blue-700', cancelled: 'bg-red-100 text-red-700' }

export interface PortalProjectData {
  id: string; name: string; number: string; status: string; progress?: number | null
  address?: string | null; city?: string | null; state?: string | null; zip?: string | null
  startDate?: string | null; endDate?: string | null; description?: string | null
  jobs?: Array<{ id: string; title: string; number: string; status: string; scheduledDate?: string | null }>
  [key: string]: unknown
}

export function PortalProjects() {
  const { token, fetch: portalFetch } = usePortal()
  const [projects, setProjects] = useState<PortalProjectData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch('/projects').then((d) => setProjects(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch])
  if (loading) return <Spinner />
  const active = projects.filter((p) => p.status === 'active'), others = projects.filter((p) => p.status !== 'active')
  return (
    <div>
      <PageTitle title="Projects" subtitle="Track the progress of your projects." />
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      {projects.length === 0 ? <Empty icon={FolderKanban} text="No projects yet." /> : (
        <div className="space-y-6">
          {active.length > 0 && <Section title={`Active Projects (${active.length})`}>{active.map((p) => <ProjectCard key={p.id} project={p} token={token} />)}</Section>}
          {others.length > 0 && <Section title="Other Projects">{others.map((p) => <ProjectCard key={p.id} project={p} token={token} />)}</Section>}
        </div>
      )}
    </div>
  )
}

function ProjectCard({ project, token }: { project: PortalProjectData; token?: string }) {
  const address = [project.address, project.city, project.state].filter(Boolean).join(', ')
  return (
    <PLink to={`/portal/${token}/projects/${project.id}`} className={`block ${card} p-5 hover:shadow-md transition-all`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="p-3 bg-purple-100 rounded-lg shrink-0"><FolderKanban className="w-6 h-6 text-purple-600" /></div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-slate-100">{project.name}</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">{project.number}</p>
            {address && <p className="flex items-center gap-1 text-sm text-gray-500 mt-1 dark:text-slate-400"><MapPin className="w-3 h-3" />{address}</p>}
          </div>
        </div>
        <span className={pill(STATUS_STYLES[project.status] || STATUS_STYLES.planning)}>{project.status?.replace('_', ' ')}</span>
      </div>
      {project.progress !== null && project.progress !== undefined && (
        <div className="mt-4"><div className="flex justify-between text-sm mb-1"><span className="text-gray-600 dark:text-slate-400">Progress</span><span className="font-medium text-gray-900 dark:text-slate-100">{project.progress}%</span></div><div className="h-2 bg-gray-200 rounded-full overflow-hidden dark:bg-slate-700"><div className="h-full bg-purple-500 transition-all" style={{ width: `${project.progress}%` }} /></div></div>
      )}
      {(project.startDate || project.endDate) && <div className="flex items-center gap-4 mt-4 text-sm text-gray-500 dark:text-slate-400"><Calendar className="w-4 h-4" />{project.startDate && <span>Started: {formatDate(project.startDate)}</span>}{project.endDate && <span>Est. completion: {formatDate(project.endDate)}</span>}</div>}
      <div className="flex items-center justify-end mt-4 text-orange-600 text-sm font-medium">View details <ArrowRight className="w-4 h-4 ml-1" /></div>
    </PLink>
  )
}

export function PortalProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()
  const { token, fetch: portalFetch, sections } = usePortal()
  const [project, setProject] = useState<PortalProjectData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch(`/projects/${projectId}`).then(setProject).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch, projectId])
  if (loading) return <Spinner />
  if (!project) return <div className="text-center py-12 text-gray-500 dark:text-slate-400">{error || 'Project not found.'}</div>
  const address = [project.address, project.city, project.state, project.zip].filter(Boolean).join(', ')
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <PLink to={`/portal/${token}/projects`} className="text-orange-600 hover:underline text-sm">{'<-'} Back to Projects</PLink>
        {sections.projectFiles && <PLink to={`/portal/${token}/projects/${projectId}/files`} className={btnSecondary}>Project Files</PLink>}
      </div>
      <div className={`${card} overflow-hidden`}>
        <div className="p-6 border-b dark:border-slate-700"><div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{project.name}</h1><p className="text-gray-500 dark:text-slate-400">{project.number}</p></div><span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[project.status] || STATUS_STYLES.planning}`}>{project.status?.replace('_', ' ')}</span></div></div>
        {project.progress !== null && project.progress !== undefined && (
          <div className="p-6 border-b dark:border-slate-700"><div className="flex justify-between text-sm mb-2"><span className="font-medium text-gray-700 dark:text-slate-200">Project Progress</span><span className="font-bold text-lg text-gray-900 dark:text-slate-100">{project.progress}%</span></div><div className="h-4 bg-gray-200 rounded-full overflow-hidden dark:bg-slate-700"><div className="h-full bg-purple-500 transition-all" style={{ width: `${project.progress}%` }} /></div></div>
        )}
        <div className="p-6 border-b dark:border-slate-700">
          <h3 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Project Details</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {address && <div><dt className="text-sm text-gray-500 dark:text-slate-400">Location</dt><dd className="mt-1 text-gray-900 dark:text-slate-100">{address}</dd></div>}
            {project.startDate && <div><dt className="text-sm text-gray-500 dark:text-slate-400">Start Date</dt><dd className="mt-1 text-gray-900 dark:text-slate-100">{formatDate(project.startDate)}</dd></div>}
            {project.endDate && <div><dt className="text-sm text-gray-500 dark:text-slate-400">Estimated Completion</dt><dd className="mt-1 text-gray-900 dark:text-slate-100">{formatDate(project.endDate)}</dd></div>}
            {project.description && <div className="sm:col-span-2"><dt className="text-sm text-gray-500 dark:text-slate-400">Description</dt><dd className="mt-1 text-gray-900 whitespace-pre-wrap dark:text-slate-100">{project.description}</dd></div>}
          </dl>
        </div>
        {(project.jobs?.length ?? 0) > 0 && (
          <div className="p-6"><h3 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Recent Work</h3><div className="space-y-3">
            {project.jobs!.map((job) => (
              <div key={job.id} className="flex items-center justify-between py-2 border-b last:border-0 dark:border-slate-800">
                <div><p className="font-medium text-gray-900 dark:text-slate-100">{job.title}</p><p className="text-sm text-gray-500 dark:text-slate-400">{job.number}</p></div>
                <div className="text-right"><span className={pill(job.status === 'completed' ? 'bg-green-100 text-green-700' : job.status === 'in_progress' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700')}>{job.status?.replace('_', ' ')}</span>{job.scheduledDate && <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">{formatDate(job.scheduledDate)}</p>}</div>
              </div>
            ))}
          </div></div>
        )}
      </div>
    </div>
  )
}
