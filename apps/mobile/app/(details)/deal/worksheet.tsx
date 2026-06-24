/**
 * Deal Worksheet — quick desking on the lot: out-the-door price + monthly payment.
 * Price prefilled from the unit when launched from a unit detail.
 */

import React, { useState } from 'react'
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, Stack } from 'expo-router'
import { useTheme } from '../../../src/theme/ThemeContext'

const money = (n: number) => '$' + (Math.round(n) || 0).toLocaleString()
function payment(p: number, apr: number, m: number) {
  const r = apr / 100 / 12
  if (!p || !m) return 0
  if (!r) return p / m
  return (p * r) / (1 - Math.pow(1 + r, -m))
}

function Row({ label, v, t, bold, big }: any) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }}>
      <Text style={{ color: t.textSecondary, fontSize: big ? 15 : 14, fontWeight: bold || big ? '700' : '400' }}>{label}</Text>
      <Text style={{ color: big ? t.primary : t.text, fontSize: big ? 18 : 14, fontWeight: bold || big ? '700' : '400' }}>{v}</Text>
    </View>
  )
}

export default function DealWorksheetScreen() {
  const params = useLocalSearchParams<{ price: string; unit: string }>()
  const t = useTheme()
  const [d, setD] = useState<any>({ price: Number(params.price) || 0, trade: 0, down: 0, taxRate: 5.5, doc: 399, freight: 695 })
  const set = (k: string, v: number) => setD((s: any) => ({ ...s, [k]: v }))
  const [term, setTerm] = useState(60)

  const taxable = Math.max(0, d.price - d.trade)
  const tax = (d.taxRate / 100) * taxable
  const fees = d.doc + d.freight
  const otd = d.price + tax + fees
  const financed = Math.max(0, otd - d.down - d.trade)

  const inputs: [string, string][] = [
    ['Selling price', 'price'], ['Trade allowance', 'trade'], ['Down payment', 'down'], ['Doc fee', 'doc'], ['Freight / setup', 'freight'],
  ]

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <Stack.Screen options={{ title: params.unit ? 'Deal · ' + params.unit : 'Deal Worksheet' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          {inputs.map(([label, key]) => (
            <View key={key} style={styles.fieldRow}>
              <Text style={[styles.lbl, { color: t.textSecondary }]}>{label}</Text>
              <View style={[styles.inputWrap, { borderColor: t.border }]}>
                <Text style={{ color: t.textMuted }}>$</Text>
                <TextInput value={String(d[key] || '')} onChangeText={(v) => set(key, Number(v) || 0)} keyboardType="number-pad" style={[styles.input, { color: t.text }]} />
              </View>
            </View>
          ))}
          <View style={styles.fieldRow}>
            <Text style={[styles.lbl, { color: t.textSecondary }]}>Tax rate</Text>
            <View style={[styles.inputWrap, { borderColor: t.border }]}>
              <TextInput value={String(d.taxRate)} onChangeText={(v) => set('taxRate', Number(v) || 0)} keyboardType="decimal-pad" style={[styles.input, { color: t.text, textAlign: 'right' }]} />
              <Text style={{ color: t.textMuted }}>%</Text>
            </View>
          </View>
          <View style={[styles.fieldRow, { marginTop: 4 }]}>
            <Text style={[styles.lbl, { color: t.textSecondary }]}>Term</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[48, 60, 72].map((m) => (
                <TouchableOpacity key={m} onPress={() => setTerm(m)} style={[styles.termChip, { borderColor: term === m ? t.primary : t.border, backgroundColor: term === m ? t.primary + '22' : 'transparent' }]}>
                  <Text style={{ color: term === m ? t.primary : t.textSecondary, fontSize: 13, fontWeight: '600' }}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, marginTop: 14 }]}>
          <Row label={`Sales tax (${d.taxRate}% net of trade)`} v={money(tax)} t={t} />
          <Row label="Fees (doc + freight)" v={money(fees)} t={t} />
          <Row label="Out-the-door" v={money(otd)} t={t} bold />
          <Row label="Less down + trade" v={'-' + money(d.down + d.trade)} t={t} />
          <Row label="Amount financed" v={money(financed)} t={t} big />
          <View style={{ height: 1, backgroundColor: t.border, marginVertical: 12 }} />
          <Text style={[styles.pay, { color: t.primary }]}>{money(payment(financed, 9.99, term))}/mo</Text>
          <Text style={[styles.payNote, { color: t.textMuted }]}>estimated @ 9.99% / {term} months</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  lbl: { fontSize: 14 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, minWidth: 120, justifyContent: 'flex-end' },
  input: { paddingVertical: 8, fontSize: 15, minWidth: 70, textAlign: 'right' },
  termChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  pay: { fontSize: 28, fontWeight: '800', textAlign: 'center' },
  payNote: { fontSize: 12, textAlign: 'center', marginTop: 2 },
})
