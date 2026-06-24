/**
 * AI Trade Appraisal — instant trade-in market estimate on the lot.
 * RV / powersports / marine vertical. Calls POST /api/ai-trade/appraise.
 */

import React, { useState } from 'react'
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../src/theme/ThemeContext'
import { post } from '../../src/api/client'

const CONDITIONS = ['excellent', 'good', 'fair', 'poor']
const dollars = (n: any) => (n != null ? '$' + Number(n).toLocaleString() : '—')

function Range({ label, v, t, hi }: any) {
  return (
    <View style={[rs.box, { borderColor: t.border, backgroundColor: hi ? t.primary + '14' : 'transparent' }]}>
      <Text style={[rs.lbl, { color: t.textMuted }]}>{label}</Text>
      <Text style={[rs.val, { color: hi ? t.primary : t.text }]}>{dollars(v)}</Text>
    </View>
  )
}

export default function AiTradeScreen() {
  const t = useTheme()
  const [f, setF] = useState<any>({ year: '', make: '', model: '', mileageHours: '', condition: 'good' })
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }))
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<any>(null)
  const [err, setErr] = useState('')

  async function go() {
    if (!f.make || !f.model) { setErr('Enter at least a make and model.'); return }
    setLoading(true); setErr(''); setRes(null)
    const r = await post('/api/ai-trade/appraise', f)
    if (r.ok && r.data?.appraisal) setRes(r.data)
    else setErr(r.data?.error || r.error || 'Appraisal failed')
    setLoading(false)
  }

  const inputStyle = [styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]
  const a = res?.appraisal

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={[styles.h1, { color: t.text }]}>AI Trade Appraisal</Text>
        <Text style={[styles.sub, { color: t.textSecondary }]}>Instant market estimate for a trade-in.</Text>

        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.lbl, { color: t.textSecondary }]}>Year</Text>
              <TextInput value={String(f.year)} onChangeText={(v) => set('year', v)} placeholder="2022" placeholderTextColor={t.textMuted} keyboardType="number-pad" style={inputStyle} />
            </View>
            <View style={{ flex: 2 }}>
              <Text style={[styles.lbl, { color: t.textSecondary }]}>Make</Text>
              <TextInput value={String(f.make)} onChangeText={(v) => set('make', v)} placeholder="Bennington" placeholderTextColor={t.textMuted} style={inputStyle} />
            </View>
          </View>
          <View style={[styles.row, { marginTop: 10 }]}>
            <View style={{ flex: 2 }}>
              <Text style={[styles.lbl, { color: t.textSecondary }]}>Model</Text>
              <TextInput value={String(f.model)} onChangeText={(v) => set('model', v)} placeholder="22 SSBX" placeholderTextColor={t.textMuted} style={inputStyle} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.lbl, { color: t.textSecondary }]}>Miles / hrs</Text>
              <TextInput value={String(f.mileageHours)} onChangeText={(v) => set('mileageHours', v)} placeholder="120" placeholderTextColor={t.textMuted} keyboardType="number-pad" style={inputStyle} />
            </View>
          </View>

          <Text style={[styles.lbl, { color: t.textSecondary, marginTop: 10 }]}>Condition</Text>
          <View style={styles.chips}>
            {CONDITIONS.map((c) => (
              <TouchableOpacity key={c} onPress={() => set('condition', c)} style={[styles.chip, { borderColor: f.condition === c ? t.primary : t.border, backgroundColor: f.condition === c ? t.primary + '22' : 'transparent' }]}>
                <Text style={{ color: f.condition === c ? t.primary : t.textSecondary, fontSize: 13, textTransform: 'capitalize' }}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={go} disabled={loading} style={[styles.btn, { backgroundColor: t.primary, opacity: loading ? 0.6 : 1 }]}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Appraise</Text>}
          </TouchableOpacity>
        </View>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        {a ? (
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, marginTop: 14 }]}>
            <Text style={[styles.resTitle, { color: t.text }]}>Trade-in (wholesale)</Text>
            <View style={styles.rangeRow}>
              <Range label="Low" v={a.tradeIn?.low} t={t} />
              <Range label="Avg" v={a.tradeIn?.avg} t={t} hi />
              <Range label="High" v={a.tradeIn?.high} t={t} />
            </View>
            <Text style={[styles.resTitle, { color: t.text, marginTop: 14 }]}>Retail</Text>
            <View style={styles.rangeRow}>
              <Range label="Low" v={a.retail?.low} t={t} />
              <Range label="High" v={a.retail?.high} t={t} />
            </View>
            {a.conditionNote ? <Text style={[styles.note, { color: t.textSecondary, marginTop: 12 }]}>{a.conditionNote}</Text> : null}
            {a.reasoning ? <Text style={[styles.note, { color: t.text, marginTop: 6 }]}>{a.reasoning}</Text> : null}
            {Array.isArray(a.comps) ? a.comps.map((c: string, i: number) => <Text key={i} style={[styles.comp, { color: t.textMuted }]}>• {c}</Text>) : null}
            {res?.disclaimer ? <Text style={[styles.disc, { color: t.textMuted }]}>{res.disclaimer}</Text> : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  h1: { fontSize: 22, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 2, marginBottom: 14 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14 },
  row: { flexDirection: 'row', gap: 10 },
  lbl: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  btn: { marginTop: 14, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  err: { color: '#ef4444', fontSize: 13, marginTop: 12 },
  resTitle: { fontSize: 13, fontWeight: '700' },
  rangeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  note: { fontSize: 13, lineHeight: 19 },
  comp: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  disc: { fontSize: 10, marginTop: 12, lineHeight: 14, fontStyle: 'italic' },
})

const rs = StyleSheet.create({
  box: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  lbl: { fontSize: 10, fontWeight: '600' },
  val: { fontSize: 16, fontWeight: '700', marginTop: 2 },
})
