/**
 * The company's stage names for a roofing phone screen (roofing depth, gap 8): `stageName(status, jobType?)` answers the
 * company's name for a stage, or undefined where the screen keeps its own standard words (not a roofer, the feature off, the
 * names not loaded yet). The names are read from GET /api/roof-pipeline — the desktop's own route (labels.ts).
 */
import { useCallback, useEffect, useState } from 'react'
import { get } from '../api/client'
import { useVertical } from '../vertical/VerticalContext'
import { parseNames, stageName as nameFrom, type PipelineNames } from './labels'

let cache: PipelineNames | null = null

export function useStageName() {
  const { vertical, hasFeature } = useVertical()
  const on = vertical === 'roofing' && hasFeature('pipeline_boards')
  const [names, setNames] = useState<PipelineNames | null>(cache)
  useEffect(() => {
    if (!on) return
    let live = true
    get('/api/roof-pipeline').then((r) => { if (live && r.ok) { cache = parseNames(r.data); setNames(cache) } }).catch(() => {})
    return () => { live = false }
  }, [on])
  const stageName = useCallback((stage: string, jobType?: string | null) => (on ? nameFrom(names, stage, jobType) : undefined), [on, names])
  return { stageName, names: on ? names : null }
}
