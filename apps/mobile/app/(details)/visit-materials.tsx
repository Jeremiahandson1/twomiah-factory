/**
 * Materials used on a visit (landscaping parity row 13; LMN, Aspire): the crew adds what they used — from the price book where the
 * business keeps one (its cost comes with it), or typed in — with how much. Each line counts in the visit's material cost (job
 * costing). With no signal a line is kept on the phone and sent later, once (its own entry key). Feature visit_materials (not ready).
 *   GET/POST /api/crew-day/visits/:jobId/materials, DELETE …/materials/:id   (jobs:read / jobs:update, the seat's own visits)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get, del } from '../../src/api/client'
import { useAuth } from '../../src/auth/AuthContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { useToast } from '../../src/components/ToastProvider'
import { useOfflineApi } from '../../src/offline/useOfflineApi'
import { useOfflineQueue } from '../../src/offline/OfflineContext'
import { materialRequest, materialsKey, quantityOf } from '../../src/trades/crewDay'
import { Screen, Card, Group, ListRow, TextField, Button, Chip, DText, EmptyState, SkeletonRows, SectionHeader, BottomSheet, space } from '../../src/design'

const newKey = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export default function VisitMaterials() {
  const router = useRouter()
  const toast = useToast()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const { jobId } = useLocalSearchParams<{ jobId: string }>()
  const offline = useOfflineApi()
  const { queue } = useOfflineQueue()
  const [lines, setLines] = useState<any[] | null>(null)
  const [book, setBook] = useState<any[]>([])
  const [picked, setPicked] = useState<any | null>(null)
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mayAdd = can('jobs:update')
  const load = useCallback(async () => {
    if (!jobId) return
    const r = await get(`/api/crew-day/visits/${jobId}/materials`)
    if (!r.ok) { setError(r.error || 'Could not load the materials'); return }
    setError(null); setLines(Array.isArray((r.data as any)?.data) ? (r.data as any).data : [])
  }, [jobId])
  useEffect(() => { load() }, [load])
  // The price book's materials, where the business has a price book and this seat may read it.
  useEffect(() => { if (hasFeature('pricebook')) get('/api/pricebook?limit=200').then((r) => { if (r.ok) { const b: any = r.data; setBook((Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : []).filter((x: any) => x.active !== false && x.type === 'material')) } }) }, [hasFeature])
  const waiting = useMemo(() => queue.filter((q) => q.recordKey === materialsKey(String(jobId))).map((q) => q.body as any), [queue, jobId])

  if (!jobId || !hasFeature('visit_materials') || !can('jobs:read')) return <Screen title="Materials used" onBack={() => router.back()}><EmptyState icon="lock-closed" title="Not available" body="Your business has not turned on materials for your seat." /></Screen>

  const add = async () => {
    const quantity = quantityOf(qty)
    if (!quantity) { toast.show('Say how much was used', 'warning'); return }
    if (!picked && !name.trim()) { toast.show('Pick the material or type its name', 'warning'); return }
    setBusy(true)
    const req = materialRequest(String(jobId), { ...(picked ? { pricebookItemId: picked.id } : { name }), quantity, unit }, newKey())
    const r = await offline.post(req.path, req.body, { recordKey: materialsKey(String(jobId)), label: `Material · ${picked?.name || name.trim()}` })
    setBusy(false)
    if (r.queued) toast.show('Saved on your phone. It will be sent when you have signal.', 'info')
    else if (!r.ok) { toast.show(r.error || 'The material was not saved', 'error'); return }
    else toast.show('Added', 'success')
    setPicked(null); setName(''); setQty(''); setUnit(''); load()
  }
  const remove = async (id: string) => {
    const r = await del(`/api/crew-day/visits/${jobId}/materials/${id}`)
    setRemoving(null)
    if (!r.ok) toast.show(r.error || 'Could not remove it', 'error'); else load()
  }

  return (
    <Screen title="Materials used" onBack={() => router.back()}
      footer={mayAdd ? <Button label="Add material" icon="add" size="lg" fullWidth loading={busy} onPress={add} /> : undefined}>
      <View style={{ gap: space[4] }}>
        {error ? <EmptyState icon="alert-circle" title="Could not load" body={error} action="Try again" onAction={load} />
          : !lines ? <SkeletonRows count={3} />
          : lines.length || waiting.length ? (
            <Group>
              {lines.map((l, i) => <ListRow key={l.id} title={l.name} meta={`${l.quantity}${l.unit ? ` ${l.unit}` : ''}`} divider={i < lines.length - 1 || waiting.length > 0} onPress={mayAdd ? () => setRemoving(l) : undefined} />)}
              {waiting.map((w, i) => <ListRow key={w.entryKey || i} title={w.name || book.find((b) => b.id === w.pricebookItemId)?.name || 'Material'} meta={`${w.quantity}${w.unit ? ` ${w.unit}` : ''}`} badge="Waiting to send" badgeTone="warning" divider={i < waiting.length - 1} />)}
            </Group>
          ) : <DText variant="callout" tone="textSecondary">Nothing recorded yet.</DText>}
        {lines?.length && mayAdd ? <DText variant="caption" tone="textSecondary">Tap a line to remove it.</DText> : null}
        {mayAdd ? (
          <Card><View style={{ gap: space[3] }}>
            <SectionHeader title="Add what you used" />
            {book.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                {book.slice(0, 30).map((b) => <Chip key={b.id} label={b.name} selected={picked?.id === b.id} onPress={() => { setPicked(picked?.id === b.id ? null : b); setUnit(b.unit || '') }} />)}
              </View>
            ) : null}
            {!picked ? <TextField label={book.length ? 'Or type the material' : 'Material'} value={name} onChangeText={setName} placeholder="e.g. Hardwood mulch" /> : null}
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <View style={{ flex: 1 }}><TextField label="How much" value={qty} onChangeText={setQty} keyboardType="decimal-pad" required /></View>
              <View style={{ flex: 1 }}><TextField label="Unit" value={unit} onChangeText={setUnit} placeholder="yards, bags…" /></View>
            </View>
          </View></Card>
        ) : null}
      </View>
      <BottomSheet visible={!!removing} title="Remove this material?" onClose={() => setRemoving(null)}>
        <View style={{ gap: space[3] }}>
          <DText variant="body">{removing ? `${removing.name}, ${removing.quantity}${removing.unit ? ` ${removing.unit}` : ''}, comes off this visit and its cost.` : ''}</DText>
          <Button label="Remove" icon="trash" variant="secondary" fullWidth onPress={() => removing && remove(removing.id)} />
        </View>
      </BottomSheet>
    </Screen>
  )
}
