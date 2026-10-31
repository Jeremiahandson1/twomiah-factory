/**
 * What the job flow needs beyond the job itself: the job's checklists (GET /api/checklists/job/:id — Job Checklists, off for
 * a business that has not got it, then `null`) and how many photos the job has (GET /api/jobs/:id/photos where the job carries its
 * own photos). Either that cannot be read leaves its steps out rather than guessing.
 */
import { useCallback, useEffect, useState } from 'react'
import { getSaved } from '../offline/readThrough'
import { photosOnJob } from '../components/PhotoGallery'
import { useVertical } from '../vertical/VerticalContext'
import type { ChecklistInfo } from './flow'

export function useJobFlowData(jobId: string | undefined, enabled: boolean) {
  const { vertical } = useVertical()
  const [checklists, setChecklists] = useState<(ChecklistInfo & { submissions: any[]; raw: any }) | null>(null)
  const [photoCount, setPhotoCount] = useState<number | null>(null)

  const reload = useCallback(async () => {
    if (!jobId || !enabled) return
    const [c, p] = await Promise.all([
      getSaved(`/api/checklists/job/${jobId}`),
      photosOnJob(vertical) ? getSaved(`/api/jobs/${jobId}/photos`) : Promise.resolve(null),
    ])
    // A refusal (the feature is off, or this seat may not) or no answer: the checklist steps are left out.
    if (c.ok && c.data && Array.isArray(c.data.templates)) {
      setChecklists({ outstanding: c.data.outstanding || [], templates: c.data.templates, submissions: c.data.submissions || [], raw: c.data })
    } else if (c.status >= 400 && c.status < 500) setChecklists(null)
    if (p && p.ok && Array.isArray(p.data)) setPhotoCount(p.data.length)
  }, [jobId, enabled, vertical])

  useEffect(() => { void reload() }, [reload])
  return { checklists, photoCount, reload }
}
