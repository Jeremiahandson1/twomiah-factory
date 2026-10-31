/**
 * The insurance claim on a roofing job — the claim, its supplements, the mortgage-company checks and the held depreciation, so the
 * insurance follow-ups are not desktop-only (roofing parity row 12; docs/parity/roof-insurance-extras.md). Opened from the job's
 * Insurance Claim card: /(details)/job/claim?id=<jobId>.
 *
 *   · the claim and its supplements are `insurance_workflow`; the company's own supplement statuses, the checks and the depreciation
 *     are `insurance_extras` (not ready) and the office's (insurance:read) — each control asks what the route behind it asks
 *     (src/insurance/claim.ts claimSeat), as the desktop's claim page does;
 *   · every write goes through the offline queue under one record per job's claim, so a save made with no signal is kept on the
 *     phone and shown as "waiting to send", never as done; a save the server refuses is shown with its words and a way to fix it
 *     (the waiting list, app/(details)/waiting.tsx);
 *   · a figure the server withheld (a seat that does not read the books) is drawn as "hidden", never $0.
 * The rules, the words and the saves are in src/insurance/claim.ts (tested by tests/mobile/insurance-claim.test.ts).
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Linking, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/AuthContext'
import { useVertical } from '../../../src/vertical/VerticalContext'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useOfflineQueue } from '../../../src/offline/OfflineContext'
import { useOfflineApi } from '../../../src/offline/useOfflineApi'
import { describeItem } from '../../../src/offline/describe'
import type { NewItem } from '../../../src/offline/engine'
import {
  Screen, Card, Group, ListRow, SectionHeader, DText, Badge, Button, BottomSheet, TextField, Chip, EmptyState, SkeletonRows, space, layout,
} from '../../../src/design'
import {
  NEXT_CHECK_STEP, addMortgageCheck, addNote, addSupplement, approveSupplement, blankLine, certificateSent, claimKey, claimSeat, claimStatusWord, denySupplement,
  depreciationReleased, depreciationSentence, isError, moveMortgageCheck, mortgageStatusWord, setSupplementStatus, shownDay, shownMoney, startClaim, statusesFor,
  submitSupplement, supplementActions, supplementStatusWord,
  type LineInput, type PhoneCheck, type PhoneClaim, type PhoneDepreciation, type PhoneStatusDef, type PhoneSupplement,
} from '../../../src/insurance/claim'

type Sheet =
  | { kind: 'start' } | { kind: 'note' } | { kind: 'supplement' } | { kind: 'check' } | { kind: 'release' }
  | { kind: 'approve' | 'deny' | 'status'; sup: PhoneSupplement } | { kind: 'move'; check: PhoneCheck; to: string }

const SUPPLEMENT_TONE: Record<string, any> = { draft: 'neutral', submitted: 'info', approved: 'success', denied: 'danger' }
const rowsOf = (r: { ok: boolean; data: any }): any[] => (r.ok && Array.isArray(r.data?.data) ? r.data.data : [])

export default function InsuranceClaimScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const haptics = useHaptics()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const { queue } = useOfflineQueue()
  const offline = useOfflineApi()
  const seat = claimSeat(can, hasFeature)

  const [claim, setClaim] = useState<PhoneClaim | null>(null)
  const [supplements, setSupplements] = useState<PhoneSupplement[]>([])
  const [activity, setActivity] = useState<any[]>([])
  const [statuses, setStatuses] = useState<PhoneStatusDef[]>([])
  const [checks, setChecks] = useState<PhoneCheck[]>([])
  const [dep, setDep] = useState<PhoneDepreciation | null>(null)
  const [loading, setLoading] = useState(true)
  const [unreadable, setUnreadable] = useState(false)
  /** The job the claim is on: a claim can be started on an insurance job only (the server refuses any other). */
  const [jobInfo, setJobInfo] = useState<{ insurance: boolean; number: string }>({ insurance: false, number: 'Job' })
  const [refreshing, setRefreshing] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [busy, setBusy] = useState(false)

  // The boxes of whichever sheet is open.
  const [f, setF] = useState<Record<string, string>>({})
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const [lines, setLines] = useState<LineInput[]>([blankLine()])
  const open = (s: Sheet, start: Record<string, string> = {}) => { setF(start); setLines([blankLine()]); setSheet(s) }

  const load = useCallback(async () => {
    const res = await get(`/api/insurance/claims/${jobId}`)
    if (res.status === 404) {
      const j = await get(`/api/jobs/${jobId}`)
      if (j.ok) setJobInfo({ insurance: j.data?.jobType === 'insurance', number: String(j.data?.number || 'Job') })
      setClaim(null); setUnreadable(false); setLoading(false); return
    }
    if (!res.ok) { setUnreadable(true); setLoading(false); return }
    const c = res.data as PhoneClaim
    setClaim(c); setUnreadable(false)
    const [sup, act] = await Promise.all([get(`/api/insurance/claims/${c.id}/supplements`), get(`/api/insurance/claims/${c.id}/activity`)])
    setSupplements(rowsOf(sup)); setActivity(rowsOf(act))
    if (seat.extras) {
      const [d, ch, st] = await Promise.all([
        get(`/api/insurance-extras/claims/${c.id}/depreciation`), get(`/api/insurance-extras/mortgage-checks?claimId=${encodeURIComponent(c.id)}`), get('/api/insurance-extras/supplement-statuses'),
      ])
      setDep(d.ok ? (d.data as PhoneDepreciation) : null); setChecks(rowsOf(ch)); setStatuses(rowsOf(st))
    }
    setLoading(false)
  }, [jobId, seat.extras])
  useEffect(() => { void load() }, [load])

  // When something waiting on the phone is sent (or refused), the claim is read again.
  const waiting = queue.filter((q) => q.recordKey === claimKey(String(jobId)))
  const signature = waiting.map((q) => `${q.id}:${q.state}`).join(',')
  useEffect(() => { void load() }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Send a save now, or keep it on the phone with no signal. Says what happened; a refusal comes back in the server's words. */
  const save = async (req: NewItem | { error: string }, done: string): Promise<boolean> => {
    if (isError(req)) { haptics.error(); toast.error(req.error); return false }
    setBusy(true)
    const r = await offline.post(req.path, req.body, { recordKey: req.recordKey, label: req.label })
    setBusy(false)
    if (r.queued) { haptics.success(); toast.success('Saved on the phone — waiting to send'); setSheet(null); return true }
    if (r.ok) { haptics.success(); toast.success(done); setSheet(null); void load(); return true }
    haptics.error(); toast.error(r.error || 'That did not go through')
    return false
  }
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }
  const back = () => router.back()
  const job = String(jobId)

  if (!seat.open) return <Screen title="Insurance claim" onBack={back}><EmptyState icon="shield" title="Not switched on" body="Insurance claims are not part of this account." /></Screen>
  if (loading) return <Screen title="Insurance claim" onBack={back}><SkeletonRows count={4} /></Screen>
  if (unreadable) return <Screen title="Insurance claim" onBack={back} refreshing={refreshing} onRefresh={onRefresh}><EmptyState icon="cloud-offline" title="The claim could not be loaded" body="Check the signal and pull down to try again." /></Screen>

  const waitingBanner = waiting.length > 0 ? (
    <Card>
      <View style={{ gap: space[2] }}>
        <DText variant="bodyStrong">{waiting.some((q) => q.state === 'failed') ? 'Something could not be sent' : 'Waiting to send'}</DText>
        {waiting.map((q) => {
          const line = describeItem(q)
          return <DText key={q.id} variant="callout" tone={line.failed ? 'danger' : 'textSecondary'}>{`${line.title} — ${line.headline}${line.detail ? `: ${line.detail}` : ''}`}</DText>
        })}
        {waiting.some((q) => q.state === 'failed') ? <Button label="Fix it in the waiting list" variant="secondary" onPress={() => router.push('/(details)/waiting' as any)} /> : null}
      </View>
    </Card>
  ) : null

  // ── no claim yet ──────────────────────────────────────────────────────────────────────────────────────────────
  if (!claim) {
    return (
      <Screen title="Insurance claim" onBack={back} refreshing={refreshing} onRefresh={onRefresh}>
        <View style={{ gap: layout.sectionGap }}>
          {waitingBanner}
          <EmptyState icon="shield" title="No claim yet"
            body={!jobInfo.insurance ? 'Only an insurance job has a claim. Change the job’s type to insurance first.' : seat.file ? 'Start one to track the adjuster, supplements and the carrier’s checks.' : 'No claim has been started on this job.'}
            action={jobInfo.insurance && seat.file && waiting.length === 0 ? 'Start the claim' : undefined} onAction={() => open({ kind: 'start' })} />
        </View>
        <BottomSheet visible={sheet?.kind === 'start'} title="Start the claim" onClose={() => setSheet(null)}>
          <View style={{ gap: space[3] }}>
            <TextField label="Insurance company" value={f.insuranceCompany || ''} onChangeText={set('insuranceCompany')} required />
            <TextField label="Claim number" value={f.claimNumber || ''} onChangeText={set('claimNumber')} required />
            <TextField label="Policy number" value={f.policyNumber || ''} onChangeText={set('policyNumber')} />
            <TextField label="Adjuster" value={f.adjusterName || ''} onChangeText={set('adjusterName')} />
            <TextField label="Adjuster phone" value={f.adjusterPhone || ''} onChangeText={set('adjusterPhone')} keyboardType="phone-pad" />
            <TextField label="Deductible" value={f.deductible || ''} onChangeText={set('deductible')} keyboardType="decimal-pad" prefix="$" />
            <Button label="Start the claim" size="lg" fullWidth loading={busy}
              onPress={() => save(startClaim(job, { claimNumber: f.claimNumber || '', insuranceCompany: f.insuranceCompany || '', policyNumber: f.policyNumber, adjusterName: f.adjusterName, adjusterPhone: f.adjusterPhone, deductible: f.deductible }, jobInfo.number), 'Claim started')} />
          </View>
        </BottomSheet>
      </Screen>
    )
  }

  const showMoney = !claim.moneyWithheld
  const figures: [string, unknown][] = [['Deductible', claim.deductible], ['RCV', claim.rcv], ['ACV', claim.acv], ['Depreciation held', claim.depreciationHeld], ['Approved supplements', claim.supplementAmount], ['Final approved', claim.finalApprovedAmount]]
  const shownFigures = figures.filter(([, v]) => v !== null && v !== undefined && v !== '')

  return (
    <Screen title={claim.insuranceCompany} subtitle={`Claim ${claim.claimNumber}`} onBack={back} refreshing={refreshing} onRefresh={onRefresh}
      footer={seat.file ? <Button label="Add a note" icon="create" variant="secondary" size="lg" fullWidth onPress={() => open({ kind: 'note' })} /> : undefined}>
      <View style={{ gap: layout.sectionGap }}>
        {waitingBanner}

        <Card>
          <View style={{ gap: space[3] }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <DText variant="callout" tone="textSecondary">{claim.policyNumber ? `Policy ${claim.policyNumber}` : 'Insurance claim'}</DText>
              {claim.claimStatus ? <Badge label={claimStatusWord(claim.claimStatus)} tone="info" /> : null}
            </View>
            {claim.adjusterName ? (
              <ListRow icon="person" title={claim.adjusterName} subtitle={claim.adjusterPhone ? `Adjuster · ${claim.adjusterPhone}` : 'Adjuster'} divider={false}
                onPress={claim.adjusterPhone ? () => { void Linking.openURL(`tel:${claim.adjusterPhone}`) } : undefined} />
            ) : null}
            {showMoney
              ? shownFigures.map(([label, v]) => (
                <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}><DText variant="callout" tone="textSecondary">{label}</DText><DText variant="bodyStrong">{shownMoney(v)}</DText></View>
              ))
              : <DText variant="callout" tone="textSecondary">The claim’s figures are hidden for your role.</DText>}
          </View>
        </Card>

        <View>
          <SectionHeader title="Supplements" action={seat.file ? 'Add' : undefined} onAction={() => open({ kind: 'supplement' })} />
          {supplements.length === 0 ? <DText variant="callout" tone="textSecondary">No supplements yet.</DText> : (
            <View style={{ gap: space[3] }}>
              {supplements.map((s) => {
                const custom = statuses.find((x) => x.id === s.customStatusId)
                const actions = supplementActions(s, seat, statuses)
                return (
                  <Card key={s.id}>
                    <View style={{ gap: space[2] }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[2] }}>
                        <DText variant="bodyStrong">{s.supplementNumber}</DText>
                        <View style={{ flexDirection: 'row', gap: space[1], flexWrap: 'wrap', justifyContent: 'flex-end', flex: 1 }}>
                          <Badge label={supplementStatusWord(s.status)} tone={SUPPLEMENT_TONE[s.status] || 'neutral'} />
                          {custom ? <Badge label={custom.name} tone="warning" /> : null}
                        </View>
                      </View>
                      {s.reason ? <DText variant="callout" tone="textSecondary">{s.reason}</DText> : null}
                      {s.moneyWithheld ? <DText variant="callout" tone="textSecondary">Amounts hidden for your role.</DText> : (
                        <DText variant="callout">{`Asked ${shownMoney(s.totalAmount)}${s.status === 'approved' && s.approvedAmount ? ` · approved ${shownMoney(s.approvedAmount)}` : ''}`}</DText>
                      )}
                      {s.status === 'denied' && s.denialReason ? <DText variant="callout" tone="danger">{`Denied: ${s.denialReason}`}</DText> : null}
                      {actions.length ? (
                        <View style={{ gap: space[2] }}>
                          {actions.map((a) => (
                            <Button key={a.id} label={a.label} variant={a.id === 'submit' ? 'primary' : a.id === 'deny' ? 'secondary' : 'tonal'}
                              onPress={() => {
                                if (a.id === 'submit') void save(submitSupplement(job, s), 'Supplement submitted')
                                else if (a.id === 'approve') open({ kind: 'approve', sup: s }, { amount: s.approvedAmount ? String(s.approvedAmount) : s.totalAmount && !s.moneyWithheld ? String(s.totalAmount) : '' })
                                else open({ kind: a.id, sup: s })
                              }} />
                          ))}
                        </View>
                      ) : s.status === 'submitted' ? <DText variant="caption" tone="textSubtle">Awaiting the carrier. A manager records their answer.</DText> : null}
                    </View>
                  </Card>
                )
              })}
            </View>
          )}
        </View>

        {seat.extras && dep && dep.state !== 'none_held' ? (
          <View>
            <SectionHeader title="Held depreciation" />
            <Card>
              <View style={{ gap: space[3] }}>
                <DText variant="body">{depreciationSentence(dep, shownDay, shownMoney)}</DText>
                {dep.state !== 'recovered' ? (
                  <View style={{ gap: space[2] }}>
                    {seat.file && dep.state !== 'job_not_done' ? <Button label={dep.certificateSentAt ? 'Certificate sent again today' : 'I sent the certificate'} onPress={() => save(certificateSent(job, claim.id, new Date()), 'Marked as sent')} /> : null}
                    {seat.decide ? <Button label="Record the release" variant="tonal" onPress={() => open({ kind: 'release' })} /> : null}
                  </View>
                ) : null}
              </View>
            </Card>
          </View>
        ) : null}

        {seat.extras ? (
          <View>
            <SectionHeader title="Mortgage-company checks" action={seat.file ? 'Add' : undefined} onAction={() => open({ kind: 'check' })} />
            {checks.length === 0 ? <DText variant="callout" tone="textSecondary">No mortgage-company checks on this claim.</DText> : (
              <View style={{ gap: space[3] }}>
                {checks.map((c) => {
                  const next = NEXT_CHECK_STEP[c.status]
                  return (
                    <Card key={c.id}>
                      <View style={{ gap: space[2] }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space[2] }}>
                          <DText variant="bodyStrong" style={{ flex: 1 }}>{`${c.mortgageCompany}${c.checkNumber ? ` · check ${c.checkNumber}` : ''}`}</DText>
                          <DText variant="bodyStrong">{c.moneyWithheld ? 'hidden' : shownMoney(c.amount)}</DText>
                        </View>
                        <DText variant="callout" tone="textSecondary">
                          {[mortgageStatusWord(c.status), c.loanNumber ? `loan ${c.loanNumber}` : '', c.sentAt ? `sent ${shownDay(c.sentAt)}` : '', c.trackingNumber ? `tracking ${c.trackingNumber}` : '',
                            c.endorsedAt ? `endorsed ${shownDay(c.endorsedAt)}` : '', c.depositedAt ? `deposited ${shownDay(c.depositedAt)}` : ''].filter(Boolean).join(' · ')}
                        </DText>
                        {seat.edit && next ? <Button label={next.label} variant="tonal" onPress={() => open({ kind: 'move', check: c, to: next.status })} /> : null}
                      </View>
                    </Card>
                  )
                })}
              </View>
            )}
          </View>
        ) : null}

        <View>
          <SectionHeader title="Activity" />
          {activity.length === 0 ? <DText variant="callout" tone="textSecondary">Nothing yet.</DText> : (
            <Group>{activity.slice(0, 30).map((a, i) => <ListRow key={a.id || i} title={String(a.body)} meta={a.createdAt ? new Date(a.createdAt).toLocaleDateString() : undefined} divider={i < Math.min(activity.length, 30) - 1} />)}</Group>
          )}
        </View>
      </View>

      <BottomSheet visible={sheet?.kind === 'note'} title="Add a note" onClose={() => setSheet(null)}>
        <View style={{ gap: space[3] }}>
          <TextField label="What happened?" value={f.note || ''} onChangeText={set('note')} multiline />
          <Button label="Save note" size="lg" fullWidth loading={busy} onPress={() => save(addNote(job, claim.id, f.note || ''), 'Note added')} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet?.kind === 'supplement'} title="Add a supplement" onClose={() => setSheet(null)}>
        <View style={{ gap: space[3] }}>
          <TextField label="Why is it needed?" value={f.reason || ''} onChangeText={set('reason')} multiline required />
          {lines.map((l, i) => (
            <View key={i} style={{ gap: space[2] }}>
              <DText variant="captionStrong" tone="textSecondary">{`Line ${i + 1}`}</DText>
              <TextField label="What it is" value={l.description} onChangeText={(v) => setLines((x) => x.map((r, j) => (j === i ? { ...r, description: v } : r)))} />
              <View style={{ flexDirection: 'row', gap: space[2] }}>
                <View style={{ flex: 1 }}><TextField label="Quantity" value={l.qty} onChangeText={(v) => setLines((x) => x.map((r, j) => (j === i ? { ...r, qty: v } : r)))} keyboardType="decimal-pad" /></View>
                <View style={{ flex: 1 }}><TextField label="Unit" value={l.unit} onChangeText={(v) => setLines((x) => x.map((r, j) => (j === i ? { ...r, unit: v } : r)))} /></View>
                <View style={{ flex: 1.3 }}><TextField label="Price each" value={l.unitPrice} onChangeText={(v) => setLines((x) => x.map((r, j) => (j === i ? { ...r, unitPrice: v } : r)))} keyboardType="decimal-pad" prefix="$" /></View>
              </View>
            </View>
          ))}
          <Button label="Add another line" icon="add" variant="secondary" onPress={() => setLines((x) => [...x, blankLine()])} />
          <TextField label="Notes" value={f.notes || ''} onChangeText={set('notes')} multiline />
          <Button label="Save supplement" size="lg" fullWidth loading={busy} onPress={() => save(addSupplement(job, claim.id, f.reason || '', lines, f.notes), 'Supplement saved')} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet?.kind === 'approve'} title={sheet?.kind === 'approve' ? `Record approval — ${sheet.sup.supplementNumber}` : ''} onClose={() => setSheet(null)}>
        <View style={{ gap: space[3] }}>
          <DText variant="callout" tone="textSecondary">The claim’s supplement total is the sum of what the carrier approved, so this figure moves the money. A carrier may approve more or less than was asked.</DText>
          <TextField label="Amount the carrier approved" value={f.amount || ''} onChangeText={set('amount')} keyboardType="decimal-pad" prefix="$" />
          <Button label="Record approval" size="lg" fullWidth loading={busy} onPress={() => sheet?.kind === 'approve' && save(approveSupplement(job, sheet.sup, f.amount || ''), 'Approval recorded')} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet?.kind === 'deny'} title={sheet?.kind === 'deny' ? `Record denial — ${sheet.sup.supplementNumber}` : ''} onClose={() => setSheet(null)}>
        <View style={{ gap: space[3] }}>
          <TextField label="Why did the carrier deny it?" value={f.reason || ''} onChangeText={set('reason')} multiline required />
          <Button label="Record denial" variant="danger" size="lg" fullWidth loading={busy} onPress={() => sheet?.kind === 'deny' && save(denySupplement(job, sheet.sup, f.reason || ''), 'Denial recorded')} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet?.kind === 'status'} title="Your status" onClose={() => setSheet(null)}>
        {sheet?.kind === 'status' ? (
          <View style={{ gap: space[3] }}>
            <DText variant="callout" tone="textSecondary">{`Where ${sheet.sup.supplementNumber} stands. It does not change the supplement’s ${supplementStatusWord(sheet.sup.status).toLowerCase()} status or the claim’s money.`}</DText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {statusesFor(sheet.sup.status, statuses).map((x) => (
                <Chip key={x.id} label={x.name} selected={sheet.sup.customStatusId === x.id} onPress={() => save(setSupplementStatus(job, sheet.sup, x.id, x.name), 'Status set')} />
              ))}
            </View>
            {sheet.sup.customStatusId ? <Button label="Take it off" variant="secondary" fullWidth loading={busy} onPress={() => save(setSupplementStatus(job, sheet.sup, null), 'Status cleared')} /> : null}
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet visible={sheet?.kind === 'check'} title="Add a mortgage-company check" onClose={() => setSheet(null)}>
        <View style={{ gap: space[3] }}>
          <TextField label="Mortgage company" value={f.mortgageCompany || ''} onChangeText={set('mortgageCompany')} required />
          <TextField label="Amount" value={f.amount || ''} onChangeText={set('amount')} keyboardType="decimal-pad" prefix="$" required />
          <TextField label="Loan number" value={f.loanNumber || ''} onChangeText={set('loanNumber')} />
          <TextField label="Check number" value={f.checkNumber || ''} onChangeText={set('checkNumber')} />
          <Button label="Save check" size="lg" fullWidth loading={busy} onPress={() => save(addMortgageCheck(job, claim.id, { mortgageCompany: f.mortgageCompany || '', amount: f.amount || '', loanNumber: f.loanNumber, checkNumber: f.checkNumber }, new Date()), 'Check recorded')} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet?.kind === 'move'} title={sheet?.kind === 'move' ? NEXT_CHECK_STEP[sheet.check.status]?.label || 'Move the check' : ''} onClose={() => setSheet(null)}>
        {sheet?.kind === 'move' ? (
          <View style={{ gap: space[3] }}>
            <DText variant="body">{`${sheet.check.mortgageCompany}${sheet.check.checkNumber ? `, check ${sheet.check.checkNumber}` : ''}: today’s date is recorded.`}</DText>
            {sheet.to === 'sent_to_mortgage' ? <TextField label="Tracking number (optional)" value={f.tracking || ''} onChangeText={set('tracking')} /> : null}
            <Button label="Save" size="lg" fullWidth loading={busy} onPress={() => save(moveMortgageCheck(job, sheet.check, sheet.to, new Date(), f.tracking || ''), 'Check updated')} />
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet visible={sheet?.kind === 'release'} title="Record the release" onClose={() => setSheet(null)}>
        <View style={{ gap: space[3] }}>
          <DText variant="callout" tone="textSecondary">The amount of held depreciation the carrier released.</DText>
          <TextField label="Amount released" value={f.released || ''} onChangeText={set('released')} keyboardType="decimal-pad" prefix="$" />
          <Button label="Record the release" size="lg" fullWidth loading={busy} onPress={() => save(depreciationReleased(job, claim.id, f.released || '', new Date()), 'Recorded')} />
        </View>
      </BottomSheet>
    </Screen>
  )
}
