/**
 * The tech's job flow on the job screen: on my way → arrived → checklist → photos → customer signs → complete, one big next
 * step, the rest as ticks. Every move goes through the offline queue (../offline), so it works with no signal and says
 * so: a step that has been saved on the phone but not sent shows "Waiting to send"; one the server refused shows
 * "Couldn't send — tap to fix" with the server's words. The rule is ./flow.ts (tests/mobile/job-flow.test.ts).
 */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Card, DText, Badge, Button, Icon, space } from '../design'
import { buildFlow, type ChecklistInfo, type FlowStep, type StepKey } from './flow'
import type { ItemView } from '../offline/engine'

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { done: 'success', waiting: 'warning', failed: 'danger', next: 'info', todo: 'neutral' }
const WORDS: Record<string, string> = { done: 'Done', waiting: 'Waiting to send', failed: "Couldn't send — tap to fix", next: 'Next', todo: 'To do' }
const BUTTON: Record<StepKey, { label: string; icon: string }> = {
  on_hold: { label: 'Resume work', icon: 'play' },
  on_my_way: { label: 'On my way', icon: 'navigate' }, arrived: { label: "I've arrived", icon: 'location' },
  checklist: { label: 'Fill in the checklist', icon: 'clipboard' }, photos: { label: 'Add photos below', icon: 'camera' },
  signature: { label: 'Get the customer’s signature', icon: 'create' }, complete: { label: 'Complete job', icon: 'checkmark-circle' },
}

export function JobFlowCard({ jobId, status, queue, checklists, photoCount, busy, onMove, onComplete, startedAt }: {
  jobId: string; status: string; queue: ItemView[]; checklists: (ChecklistInfo & { submissions?: any[] }) | null; photoCount: number | null
  busy: boolean; onMove: (move: 'dispatch' | 'start' | 'hold') => void; onComplete: () => void; startedAt?: string | null
}) {
  const router = useRouter()
  const flow = buildFlow({ jobId, status, queue, checklists, photoCount, startedAt })
  const open = (sub?: string | null) => router.push(`/(details)/job/checklist?id=${jobId}${sub ? `&sign=${sub}` : ''}` as any)
  const waitingSig = checklists?.outstanding.find((o) => o.why === 'needs the customer to sign')

  const act = (key: StepKey) => {
    if (key === 'on_hold') onMove('start')
    else if (key === 'on_my_way') onMove('dispatch')
    else if (key === 'arrived') onMove('start')
    else if (key === 'checklist') open()
    else if (key === 'signature') open(waitingSig?.submissionId)
    else if (key === 'complete') onComplete()
  }
  const failed = flow.steps.find((s) => s.state === 'failed')
  const next = flow.next
  const blocked = next === 'complete' ? flow.completeBlockedBy : null

  return (
    <Card>
      <View style={{ gap: space[3] }}>
        <DText variant="headline">Your job</DText>
        {flow.steps.map((s: FlowStep) => (
          <View key={s.key} style={{ gap: space[1] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <Icon name={s.state === 'done' ? 'checkmark-circle' : s.state === 'failed' ? 'alert-circle' : s.state === 'waiting' ? 'time' : 'ellipse-outline'} size={22} tone={s.state === 'done' ? 'success' : s.state === 'failed' ? 'danger' : s.state === 'waiting' ? 'warning' : 'neutral'} />
              <DText variant="bodyStrong" style={{ flex: 1 }}>{s.label}</DText>
              <Badge label={WORDS[s.state]} tone={TONE[s.state]} />
            </View>
            {s.note && s.state !== 'done' ? <DText variant="caption" tone={s.state === 'failed' ? 'danger' : 'textSecondary'} style={{ marginLeft: 30 }}>{s.note}</DText> : null}
          </View>
        ))}
        {failed ? <DText variant="callout" tone="danger">The server refused one step. Open Waiting to send to try again or drop it.</DText> : null}
        {blocked ? <DText variant="callout" tone="textSecondary">Finish the checklist first: {blocked}.</DText> : null}
        {next && next !== 'photos' ? (
          <Button size="lg" fullWidth label={BUTTON[next].label} icon={BUTTON[next].icon} loading={busy} disabled={!!blocked} onPress={() => act(next)} />
        ) : null}
        {next === 'photos' ? <DText variant="callout" tone="textSecondary">Take a photo of the work in Photos below, then complete the job.</DText> : null}
        {flow.canHold ? <Button variant="ghost" fullWidth label="Put on hold" icon="pause" disabled={busy} onPress={() => onMove('hold')} /> : null}
      </View>
    </Card>
  )
}
