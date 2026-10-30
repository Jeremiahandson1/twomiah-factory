/** A trade's detail screen, drawn from its spec: sections of fields and rows, and the actions this seat may take (each behind its confirm). */
import React, { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { Linking } from 'react-native'
import { useRouter } from 'expo-router'
import { Screen, Group, ListRow, EmptyState, SkeletonRows, Button, DText, SectionHeader, space } from '../design'
import { get } from '../api/client'
import { ActionSheet } from './ActionSheet'
import { useAuth } from '../auth/AuthContext'
import { useVertical } from '../vertical/VerticalContext'
import { specFor } from './specs'
import { unwrap, rowCache, mayUse, type Action } from './kit'

export function TradeDetail({ spec: id, rowId, tab }: { spec: string; rowId: string; tab?: boolean }) {
  const router = useRouter()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const spec = specFor(id)
  const [d, setD] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Action | null>(null)
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
  if (!mayUse(spec, can, hasFeature)) return <Screen title={spec.title} onBack={tab ? undefined : () => router.back()}><EmptyState icon="lock-closed" title="Not for this seat" body="Your role does not include this screen." /></Screen>
  const det = spec.detail
  const actions = (det.actions || []).filter((a) => d && a.any.some((p) => can(p)) && (!a.feature || hasFeature(a.feature)) && (!a.when || a.when(d)))
  const start = (a: Action) => setOpen(a)
  return (
    <Screen title={d ? det.title(d) : spec.title} subtitle={d ? det.subtitle?.(d) : undefined} onBack={tab ? undefined : () => router.back()}
      footer={actions.length ? <View style={{ gap: space[2] }}>{actions.map((a, i) => <Button key={a.id} label={a.label} icon={a.icon} variant={i === 0 ? 'primary' : 'secondary'} fullWidth onPress={() => start(a)} />)}</View> : undefined}>
      {error ? <EmptyState icon="alert-circle" title="Could not load this" body={error} action="Try again" onAction={load} />
        : !d ? <SkeletonRows count={4} /> : (
          <View style={{ gap: space[4] }}>
            {det.badge?.(d) ? <DText variant="bodyStrong" tone="textSecondary">{det.badge(d)}</DText> : null}
            {det.sections.filter((s) => !s.feature || hasFeature(s.feature)).map((s, si) => {
              const fields = (s.fields || []).map((f) => ({ f, v: f.get(d) })).filter((x) => x.v != null && x.v !== '')
              const rows = s.rows?.(d) || []
              const links = s.links?.(d) || []
              if (!fields.length && !rows.length && !links.length && !s.empty) return null
              return (
                <View key={si} style={{ gap: space[2] }}>
                  {s.title ? <SectionHeader title={s.title} /> : null}
                  {fields.length ? <Group>{fields.map(({ f, v }, i) => String(v).length > 26 || String(v).includes('\n') ? <ListRow key={f.label} title={f.label} subtitle={String(v)} divider={i < fields.length - 1} /> : <ListRow key={f.label} title={f.label} meta={String(v)} divider={i < fields.length - 1} />)}</Group> : null}
                  {links.length ? <Group>{links.map((l, i) => <ListRow key={l.label} title={l.label} icon={l.icon} divider={i < links.length - 1} onPress={() => { if (l.route) router.push(l.route as any); else Linking.openURL(l.url) }} />)}</Group> : null}
                  {rows.length ? <Group>{rows.map((r, i) => { const long = !!r.meta && r.meta.length > 12; return <ListRow key={r.key} title={r.title} subtitle={long ? [r.subtitle, r.meta].filter(Boolean).join(' · ') : r.subtitle} meta={long ? undefined : r.meta} badge={r.badge} badgeTone={r.tone} divider={i < rows.length - 1} /> })}</Group>
                    : !fields.length && !links.length && s.empty ? <DText variant="callout" tone="textSecondary">{s.empty}</DText> : null}
                </View>
              )
            })}
          </View>
        )}
      <ActionSheet action={open} row={d} onClose={() => setOpen(null)} onDone={() => { if (spec.detail?.path(rowId) === null && !tab) router.back(); else load() }} />
    </Screen>
  )
}
