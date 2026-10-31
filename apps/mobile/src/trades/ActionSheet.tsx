/** The sheet every kit write goes through: the words that say what will happen (confirm), the inputs, the button — and the server's own refusal shown as it came. */
import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { BottomSheet, Button, DText, TextField, Chip, space } from '../design'
import { api, get } from '../api/client'
import { useToast } from '../components/ToastProvider'
import { unwrap, type Action } from './kit'

/** The choices wrap onto more lines instead of hiding behind a sideways scroll: every answer is on the screen. */
const Wrap = ({ children }: { children: React.ReactNode }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>{children}</View>

export function ActionSheet({ action, row, onClose, onDone }: { action: Action | null; row: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
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
        const b = unwrap(r.data); const rows: any[] = Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : []
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
    const r = await api(req.path, { method: req.method, body: req.body === undefined ? undefined : JSON.stringify(req.body) })
    setBusy(false)
    if (!r.ok) { toast.show(r.error || 'That did not go through', 'error'); return }
    toast.show(action.done, 'success'); onClose(); onDone()
  }
  return (
    <BottomSheet visible={!!action} title={action?.confirm?.title || action?.label || ''} onClose={onClose}>
      {action ? (
        <View style={{ gap: space[3] }}>
          {action.confirm ? <DText variant="body">{action.confirm.body(row)}</DText> : null}
          {(action.inputs || []).map((inp) => inp.options ? (
            <View key={inp.id} style={{ gap: space[1] }}><DText variant="bodyStrong">{inp.label}</DText>
              {!offered[inp.id] ? <DText variant="callout" tone="textSecondary">Getting prices…</DText>
                : offered[inp.id].none ? <DText variant="callout" tone="textSecondary">{offered[inp.id].none}</DText>
                : <View style={{ gap: space[2] }}>{Object.keys(offered[inp.id].map).map((c) => <Button key={c} label={c} variant={values[inp.id] === c ? 'primary' : 'secondary'} fullWidth onPress={() => setValues((v) => ({ ...v, [inp.id]: c }))} />)}</View>}</View>
          ) : inp.kind === 'choice' ? (
            <View key={inp.id} style={{ gap: space[1] }}><DText variant="bodyStrong">{inp.label}</DText>
              <Wrap>{(inp.choices || []).map((c) => <Chip key={c} label={c.replace(/_/g, ' ')} selected={values[inp.id] === c} onPress={() => setValues((v) => ({ ...v, [inp.id]: c }))} />)}</Wrap></View>
          ) : inp.kind === 'level' ? (
            <View key={inp.id} style={{ gap: space[1] }}><DText variant="bodyStrong">{inp.label}</DText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                <Button label="−5" variant="secondary" onPress={() => setValues((v) => ({ ...v, [inp.id]: v[inp.id] === undefined || v[inp.id] === '' ? '' : String(Math.max(0, Number(v[inp.id]) - 5)) }))} />
                <View accessibilityRole="adjustable" accessibilityLabel={inp.label} accessibilityValue={{ min: 0, max: 100, now: values[inp.id] === '' || values[inp.id] === undefined ? 0 : Number(values[inp.id]) }} style={{ flex: 1, height: 12, borderRadius: 6, backgroundColor: '#d1d5db', overflow: 'hidden' }}>
                  <View style={{ width: `${values[inp.id] === '' || values[inp.id] === undefined ? 0 : Number(values[inp.id])}%`, height: 12, backgroundColor: '#ea580c' }} />
                </View>
                <Button label="+5" variant="secondary" onPress={() => setValues((v) => ({ ...v, [inp.id]: v[inp.id] === undefined || v[inp.id] === '' ? '100' : String(Math.min(100, Number(v[inp.id]) + 5)) }))} />
              </View>
              <DText variant="callout" tone="textSecondary">{values[inp.id] === '' || values[inp.id] === undefined ? 'Not used. Tap + to add an open bottle.' : `${values[inp.id]}% full`}</DText></View>
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
