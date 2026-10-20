/**
 * Lead Detail — a roofing lead is a roofing JOB at the `lead` stage, so its page is the job's.
 *
 * This screen read GET /api/leads/:id and wrote PUT /api/leads/:id { stage } — neither route exists on the unified
 * server (/api/leads is the Lead Inbox: a list, an import and a convert, no single-lead read or stage), and its
 * fallback wrote a `stage` the contact has no column for. The pipeline is the job's status (server/crm/roof/jobs.ts):
 * scheduling the inspection, advancing the stage, closing as lost and adding notes are all on the job screen. A link
 * that still names /lead/:id is sent there.
 */
import { Redirect, useLocalSearchParams } from 'expo-router'

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <Redirect href={`/(details)/job/${id}`} />
}
