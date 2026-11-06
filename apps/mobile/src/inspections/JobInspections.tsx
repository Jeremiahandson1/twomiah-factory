/**
 * The project's inspections on the job screen (feature Inspections on the Phone). Tap one to answer its checklist. Reading only
 * needs inspections:read; the screen behind it decides what this seat may do.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { get } from '../api/client'
import { Card, DText, Badge, ListRow, space } from '../design'
import { visitLine } from './rules'

export function JobInspections({ jobId, projectId }: { jobId: string; projectId: string }) {
  const router = useRouter()
  const [visits, setVisits] = useState<any[] | null>(null)

  const load = useCallback(async () => {
    const r = await get(`/api/inspections?projectId=${encodeURIComponent(projectId)}&limit=50`)
    setVisits(r.ok && Array.isArray(r.data?.data) ? r.data.data : [])
  }, [projectId])
  useEffect(() => { void load() }, [load])

  // Nothing to show: say nothing (a job with no inspections should not grow a card).
  if (!visits || !visits.length) return null
  return (
    <Card>
      <View style={{ gap: space[2] }}>
        <DText variant="headline">Inspections</DText>
        {visits.map((v) => {
          const line = visitLine(v)
          return (
            <ListRow key={v.id} title={line.title} subtitle={line.detail}
              badge={v.signedBy ? 'Signed' : v.status === 'passed' ? 'Passed' : v.status === 'failed' ? 'Failed' : undefined}
              badgeTone={v.status === 'failed' ? 'danger' : 'success'}
              onPress={() => router.push(`/(details)/inspection/${v.id}?job=${encodeURIComponent(jobId)}`)} />
          )
        })}
      </View>
    </Card>
  )
}
