/** The sheet every kit write goes through: the words that say what will happen (confirm), the inputs, the button — and the server's own refusal shown as it came. */
import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { BottomSheet, Button, DText, TextField, Chip, ChipRow, space } from '../design'
import { api } from '../api/client'
import { useToast } from '../components/ToastProvider'
import type { Action } from './kit'

export function ActionSheet({ action, row, onClose, onDone }: { action: Action | null; row: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (action) setValues(Object.fromEntries((action.inputs || []).map((i) => [i.id, i.initial?.(row) ?? '']))) }, [action, row])
  const run = async () => {
    if (!action) return
    const missing = (action.inputs || []).find((i) => i.required && !String(values[i.id] ?? '').trim())
    if (missing) { toast.show(`${missing.label} is needed`, 'warning'); return }
    setBusy(true)
    const req = action.request(row, values)
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
          {(action.inputs || []).map((inp) => inp.kind === 'choice' ? (
            <View key={inp.id} style={{ gap: space[1] }}><DText variant="bodyStrong">{inp.label}</DText>
              <ChipRow>{(inp.choices || []).map((c) => <Chip key={c} label={c.replace(/_/g, ' ')} selected={values[inp.id] === c} onPress={() => setValues((v) => ({ ...v, [inp.id]: c }))} />)}</ChipRow></View>
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
