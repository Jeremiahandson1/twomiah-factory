/** A trade's detail screen, drawn from its spec: sections of fields and rows, and the actions this seat may take (each behind its confirm). */
import React, { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Screen, Group, ListRow, EmptyState, SkeletonRows, Button, BottomSheet, DText, SectionHeader, TextField, Chip, ChipRow, space } from '../design'
import { get, api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/ToastProvider'
import { specFor } from './specs'
import { unwrap, rowCache, type Action } from './kit'

export function TradeDetail({ spec: id, rowId }: { spec: string; rowId: string }) {
  const router = useRouter()
  const { can } = useAuth()
  const toast = useToast()
  const spec = specFor(id)
  const [d, setD] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Action | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    if (!spec?.detail) return
    const path = spec.detail.path(rowId)
    if (path === null) { const row = rowCache.get(`${spec.id}:${rowId}`); if (row) { setError(null); setD(row) } else setError('Open this from the list'); return }
    const r = await get(path)
    if (!r.ok) { setError(r.error || 'Could not load this'); return }
    const main = unwrap(r.data)
    const also: Record<string, any> = {}
    for (const [k, p] of Object.entries(spec.detail.also || {})) { const x = await get(p(rowId)); if (x.ok) also[k] = unwrap(x.data) }
    setError(null); setD(Object.keys(also).length ? { ...main, _also: also } : main)
  }, [spec, rowId])
  useEffect(() => { load() }, [load])
  if (!spec?.detail) return <Screen title="Not found" onBack={() => router.back()}><EmptyState icon="alert-circle" title="This screen is not available" body="Go back and try again." /></Screen>
  const det = spec.detail
  const actions = (det.actions || []).filter((a) => d && a.any.some((p) => can(p)) && (!a.when || a.when(d)))
  const start = (a: Action) => { setValues(Object.fromEntries((a.inputs || []).map((i) => [i.id, i.initial?.(d) ?? '']))); setOpen(a) }
  const run = async () => {
    if (!open) return
    const missing = (open.inputs || []).find((i) => i.required && !String(values[i.id] ?? '').trim())
    if (missing) { toast.show(`${missing.label} is needed`, 'warning'); return }
    setBusy(true)
    const req = open.request(d, values)
    const r = await api(req.path, { method: req.method, body: req.body === undefined ? undefined : JSON.stringify(req.body) })
    setBusy(false)
    if (!r.ok) { toast.show(r.error || 'That did not go through', 'error'); return }
    toast.show(open.done, 'success'); setOpen(null); if (spec.detail?.path(rowId) === null) router.back(); else load()
  }
  return (
    <Screen title={d ? det.title(d) : spec.title} subtitle={d ? det.subtitle?.(d) : undefined} onBack={() => router.back()}
      footer={actions.length ? <View style={{ gap: space[2] }}>{actions.map((a, i) => <Button key={a.id} label={a.label} icon={a.icon} variant={i === 0 ? 'primary' : 'secondary'} fullWidth onPress={() => start(a)} />)}</View> : undefined}>
      {error ? <EmptyState icon="alert-circle" title="Could not load this" body={error} action="Try again" onAction={load} />
        : !d ? <SkeletonRows count={4} /> : (
          <View style={{ gap: space[4] }}>
            {det.badge?.(d) ? <DText variant="bodyStrong" tone="textSecondary">{det.badge(d)}</DText> : null}
            {det.sections.map((s, si) => {
              const fields = (s.fields || []).map((f) => ({ f, v: f.get(d) })).filter((x) => x.v != null && x.v !== '')
              const rows = s.rows?.(d) || []
              if (!fields.length && !rows.length && !s.empty) return null
              return (
                <View key={si} style={{ gap: space[2] }}>
                  {s.title ? <SectionHeader title={s.title} /> : null}
                  {fields.length ? <Group>{fields.map(({ f, v }, i) => <ListRow key={f.label} title={f.label} meta={String(v)} divider={i < fields.length - 1} />)}</Group> : null}
                  {rows.length ? <Group>{rows.map((r, i) => <ListRow key={r.key} title={r.title} subtitle={r.subtitle} meta={r.meta} badge={r.badge} badgeTone={r.tone} divider={i < rows.length - 1} />)}</Group>
                    : !fields.length && s.empty ? <DText variant="callout" tone="textSecondary">{s.empty}</DText> : null}
                </View>
              )
            })}
          </View>
        )}
      <BottomSheet visible={!!open} title={open?.confirm?.title || open?.label || ''} onClose={() => setOpen(null)}>
        {open ? (
          <View style={{ gap: space[3] }}>
            {open.confirm ? <DText variant="body">{open.confirm.body(d)}</DText> : null}
            {(open.inputs || []).map((inp) => inp.kind === 'choice' ? (
              <View key={inp.id} style={{ gap: space[1] }}><DText variant="bodyStrong">{inp.label}</DText>
                <ChipRow>{(inp.choices || []).map((c) => <Chip key={c} label={c} selected={values[inp.id] === c} onPress={() => setValues((v) => ({ ...v, [inp.id]: c }))} />)}</ChipRow></View>
            ) : (
              <TextField key={inp.id} label={inp.label} value={values[inp.id] ?? ''} required={inp.required} multiline={inp.kind === 'multiline'} keyboardType={inp.kind === 'number' ? 'decimal-pad' : 'default'}
                onChangeText={(t) => setValues((v) => ({ ...v, [inp.id]: t }))} />
            ))}
            <Button label={open.confirm?.button || open.label} loading={busy} fullWidth onPress={run} />
            <Button label="Cancel" variant="secondary" fullWidth onPress={() => setOpen(null)} />
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  )
}
