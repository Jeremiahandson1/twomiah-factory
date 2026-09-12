// Project file room: category-filtered list + upload (owner sees everything on the project, a collaborator what was shared).
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { FolderOpen, Loader2, Upload, FileUp } from 'lucide-react'
import { usePortal } from './PortalContext'
import { PLink, Spinner, PageTitle, Empty, card, inputCls, formatDate } from './common'
import { FilterBtn, DocRow } from './PortalCollaborators'

interface ProjectFile { id: string; name: string; type: string; originalName: string; size?: number | null; url: string; thumbnailUrl?: string | null; description?: string | null; createdAt: string }

export function PortalProjectFiles() {
  const { projectId } = useParams<{ projectId: string }>()
  const { token, fetch: portalFetch, config } = usePortal()
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [uploading, setUploading] = useState(false)
  const [uploadType, setUploadType] = useState('general')
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const categories = Object.entries(config.docTypeLabels).map(([key, label]) => ({ key, label }))

  const load = useCallback(() => portalFetch(`/projects/${projectId}/files`).then((d) => setFiles(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)), [portalFetch, projectId])
  useEffect(() => { load().finally(() => setLoading(false)) }, [load])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    try {
      const form = new FormData()
      form.append('file', file); form.append('type', uploadType); form.append('name', file.name)
      await portalFetch(`/projects/${projectId}/files`, { method: 'POST', body: form })
      await load()
    } catch (err) { setError((err as Error).message) } finally { setUploading(false); if (fileInput.current) fileInput.current.value = '' }
  }

  if (loading) return <Spinner />
  const filtered = filter === 'all' ? files : files.filter((f) => f.type === filter)
  const present = categories.filter((c) => files.some((f) => f.type === c.key))
  const label = (t: string) => config.docTypeLabels[t] || t

  return (
    <div>
      <div className="mb-4"><PLink to={`/portal/${token}/projects/${projectId}`} className="text-orange-600 hover:underline text-sm">{'<-'} Back to Project</PLink></div>
      <PageTitle title="Project Files" subtitle="Shared files for this project — organized by category." />
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      <div className={`${card} p-4 mb-6`}>
        <div className="flex flex-wrap items-center gap-3">
          <FileUp className="w-5 h-5 text-gray-500 dark:text-slate-400" />
          <p className="font-medium text-gray-900 dark:text-slate-100">Upload a file</p>
          <select aria-label="File category" value={uploadType} onChange={(e) => setUploadType(e.target.value)} className={`${inputCls} w-auto`}>{categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
          <input ref={fileInput} type="file" onChange={handleUpload} disabled={uploading} className="hidden" id="portal-file-upload" data-testid="portal-file-input" />
          <label htmlFor="portal-file-upload" className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg cursor-pointer ${uploading ? 'bg-gray-300 text-gray-500' : 'bg-orange-500 text-white hover:bg-orange-600'}`}>{uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}{uploading ? 'Uploading…' : 'Choose File'}</label>
        </div>
      </div>
      {files.length === 0 ? <Empty icon={FolderOpen} text="No files in this project yet." /> : (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')}>All ({files.length})</FilterBtn>
            {present.map((c) => <FilterBtn key={c.key} active={filter === c.key} onClick={() => setFilter(c.key)}>{c.label} ({files.filter((f) => f.type === c.key).length})</FilterBtn>)}
          </div>
          <div className="space-y-3">{filtered.map((f) => <DocRow key={f.id} name={f.name || f.originalName} typeLabel={label(f.type)} meta={[f.size ? `${Math.round(f.size / 1024)} KB` : '', `Added ${formatDate(f.createdAt)}`]} description={f.description} url={f.url} thumbnailUrl={f.thumbnailUrl} />)}</div>
        </>
      )}
    </div>
  )
}
