/** The sheet every kit write goes through: the words that say what will happen (confirm), the inputs, the button — and the server's own refusal shown as it came. */
import React, { useEffect, useState } from 'react'
import { PanResponder, View } from 'react-native'
import { BottomSheet, Button, DText, TextField, Chip, space } from '../design'
import { api, get } from '../api/client'
import { useToast } from '../components/ToastProvider'
import { useOfflineApi } from '../offline/useOfflineApi'
import { unwrap, type Action } from './kit'

/** A 'levels' value is a JSON list of percents; anything else reads as none. */
export const levelsOf = (v: unknown): number[] => { try { const a = JSON.parse(String(v ?? '[]')); return Array.isArray(a) ? a.map(Number).filter((n) => Number.isFinite(n)).map((n) => Math.min(100, Math.max(0, Math.round(n)))) : [] } catch { return [] } }

/**
 * A real slider for a bottle's fill (parity row 15, Backbar): drag anywhere on the bar, or tap, to set the percent in steps of 5;
 * −5 / +5 beside it for a precise nudge, and the whole thing is adjustable to a screen reader. Pure React Native (PanResponder), no native module.
 */
export function LevelSlider({ label, value, onChange, onRemove }: { label: string; value: number; onChange: (n: number) => void; onRemove?: () => void }) {
  const width = React.useRef(1)
  const set = (x: number) => onChange(Math.min(100, Math.max(0, Math.round((x / width.current) * 100 / 5) * 5)))
  const pan = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => set(e.nativeEvent.locationX), onPanResponderMove: (e) => set(e.nativeEvent.locationX),
  }), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ gap: space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Button label="−5" variant="secondary" onPress={() => onChange(Math.max(0, value - 5))} />
        <View {...pan.panHandlers} onLayout={(e) => { width.current = Math.max(1, e.nativeEvent.layout.width) }}
          accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: value, text: `${value} percent full` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(e) => onChange(e.nativeEvent.actionName === 'increment' ? Math.min(100, value + 5) : Math.max(0, value - 5))}
          style={{ flex: 1, height: 28, justifyContent: 'center' }}>
          <View style={{ height: 12, borderRadius: 6, backgroundColor: '#d1d5db', overflow: 'hidden' }}><View style={{ width: `${value}%`, height: 12, backgroundColor: '#ea580c' }} /></View>
          <View style={{ position: 'absolute', left: `${value}%`, marginLeft: -12, width: 24, height: 24, borderRadius: 12, backgroundColor: '#ea580c', borderWidth: 2, borderColor: '#fff' }} />
        </View>
        <Button label="+5" variant="secondary" onPress={() => onChange(Math.min(100, value + 5))} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <DText variant="callout" tone="textSecondary">{label}: {value}% full</DText>
        {onRemove ? <Button label="Remove" variant="ghost" onPress={onRemove} /> : null}
      </View>
    </View>
  )
}

/** The choices wrap onto more lines instead of hiding behind a sideways scroll: every answer is on the screen. */
const Wrap = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>{children}</View>

export function ActionSheet({ action, row, onClose, onDone }: { action: Action | null; row: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const offline = useOfflineApi()
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // Choices the server offers (rates for a label): { label → value }, or a sentence when it has none / refuses.
  const [offered, setOffered] = useState<Record<string, { map: Record<string, string>; none?: string }>>({})
  useEffect(() => {
    setOffered({})
    if (!action) return
    for (const inp of action.inputs || []) {
      if (!inp.options) continue
      const o = inp.options
      get(o.path(row)).then((r) => {
        if (!r.ok) { setOffered((p) => ({ ...p, [inp.id]: { map: {}, none: r.error || o.none } })); return }
        const b = unwrap(r.data); const rows: any[] = o.pick ? o.pick(r.data, row) : Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : []
        setOffered((p) => ({ ...p, [inp.id]: { map: Object.fromEntries(rows.map((x) => [o.label(x), o.value(x)])), none: rows.length ? undefined : o.none } }))
      })
    }
  }, [action, row])
  useEffect(() => { if (action) setValues(Object.fromEntries((action.inputs || []).map((i) => [i.id, i.initial?.(row) ?? '']))) }, [action, row])
  const run = async () => {
    if (!action) return
    const missing = (action.inputs || []).find((i) => i.required && !String(values[i.id] ?? '').trim())
    if (missing) { toast.show(`${missing.label} is needed`, 'warning'); return }
    setBusy(true)
    const sent = { ...values }
    for (const inp of action.inputs || []) if (inp.options) sent[inp.id] = offered[inp.id]?.map[values[inp.id]] ?? ''
    const req = action.request(row, sent)
    const keep = action.offline?.(row)
    let r: any
    try {
      r = keep
        ? await ({ POST: offline.post, PUT: offline.put, PATCH: offline.patch, DELETE: (p: string, _b: unknown, o: any) => offline.del(p, o) } as const)[req.method](req.path, req.body, { recordKey: keep.key, label: keep.label })
        : await api(req.path, { method: req.method, body: req.body === undefined ? undefined : JSON.stringify(req.body) })
    } catch {
      // A save that is not kept for later (no `offline`) and could not reach the server: said as not done, never as saved.
      r = { ok: false, error: 'No signal. This needs a connection and was not saved. Try again when you have signal.' }
    }
    setBusy(false)
    if (!r.ok) { toast.show(r.error || 'That did not go through', 'error'); return }
    // Kept on the phone, not done yet: said as waiting, never as done.
    toast.show(r.queued ? 'Saved on your phone. It will be sent when you have signal.' : action.done, r.queued ? 'info' : 'success'); onClose(); onDone()
  }
  return (
    <BottomSheet visible={!!action} title={action?.confirm?.title || action?.label || ''} onClose={onClose}>
      {action ? (
        <View style={{ gap: space[3] }}>
          {action.confirm ? <DText variant="body">{action.confirm.body(row)}</DText> : null}
          {(action.inputs || []).map((inp) => inp.options ? (
            <View key={inp.id} style={{ gap: space[1] }}><DText variant="bodyStrong">{inp.label}</DText>
              {!offered[inp.id] ? <DText variant="callout" tone="textSecondary">{inp.options.loading ?? 'Getting prices…'}</DText>
                : offered[inp.id].none ? <DText variant="callout" tone="textSecondary">{offered[inp.id].none}</DText>
                : <View style={{ gap: space[2] }}>{Object.keys(offered[inp.id].map).map((c) => <Button key={c} label={c} variant={values[inp.id] === c ? 'primary' : 'secondary'} fullWidth onPress={() => setValues((v) => ({ ...v, [inp.id]: c }))} />)}</View>}</View>
          ) : inp.kind === 'choice' ? (
            <View key={inp.id} style={{ gap: space[1] }}><DText variant="bodyStrong">{inp.label}</DText>
              <Wrap>{(inp.choices || []).map((c) => <Chip key={c} label={c.replace(/_/g, ' ')} selected={values[inp.id] === c} onPress={() => setValues((v) => ({ ...v, [inp.id]: c }))} />)}</Wrap></View>
          ) : inp.kind === 'level' ? (
            <View key={inp.id} style={{ gap: space[1] }}><DText variant="bodyStrong">{inp.label}</DText>
              {values[inp.id] === '' || values[inp.id] === undefined
                ? <Button label="Add an open bottle" variant="secondary" onPress={() => setValues((v) => ({ ...v, [inp.id]: '100' }))} />
                : <LevelSlider label={inp.label} value={Number(values[inp.id])} onChange={(n) => setValues((v) => ({ ...v, [inp.id]: String(n) }))} onRemove={() => setValues((v) => ({ ...v, [inp.id]: '' }))} />}
            </View>
          ) : inp.kind === 'levels' ? (
            <View key={inp.id} style={{ gap: space[2] }}><DText variant="bodyStrong">{inp.label}</DText>
              {levelsOf(values[inp.id]).map((n, i) => (
                <LevelSlider key={i} label={`Open bottle ${i + 1}`} value={n} onChange={(x) => setValues((v) => ({ ...v, [inp.id]: JSON.stringify(levelsOf(v[inp.id]).map((y, j) => (j === i ? x : y))) }))} onRemove={() => setValues((v) => ({ ...v, [inp.id]: JSON.stringify(levelsOf(v[inp.id]).filter((_, j) => j !== i)) }))} />
              ))}
              {levelsOf(values[inp.id]).length < 24 ? <Button label="Add an open bottle" variant="secondary" onPress={() => setValues((v) => ({ ...v, [inp.id]: JSON.stringify([...levelsOf(v[inp.id]), 100]) }))} /> : null}
              <DText variant="callout" tone="textSecondary">{levelsOf(values[inp.id]).length ? `${levelsOf(values[inp.id]).length} open bottle${levelsOf(values[inp.id]).length === 1 ? '' : 's'}: drag each to how full it is.` : 'No open bottles counted.'}</DText>
            </View>
          ) : (
            <TextField key={inp.id} label={inp.label} value={values[inp.id] ?? ''} required={inp.required} multiline={inp.kind === 'multiline'} keyboardType={inp.kind === 'number' ? 'decimal-pad' : 'default'}
              onChangeText={(t) => setValues((v) => ({ ...v, [inp.id]: t }))} />
          ))}
          <Button label={action.confirm?.button || action.label} loading={busy} fullWidth onPress={run} />
          <Button label="Cancel" variant="secondary" fullWidth onPress={onClose} />
        </View>
      ) : null}
    </BottomSheet>
  )
}
