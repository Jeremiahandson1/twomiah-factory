/**
 * Mobile F&I — present the menu and submit the credit app to lenders.
 * Launched from the deal worksheet with the financed amount.
 */

import React, { useState, useEffect } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../../src/theme/ThemeContext'
import { get, post } from '../../../src/api/client'

const money = (n: any) => '$' + (Math.round(Number(n)) || 0).toLocaleString()

function Term({ label, v, t }: any) {
  return (<View style={{ flex: 1 }}><Text style={{ color: t.textMuted, fontSize: 11 }}>{label}</Text><Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }}>{v}</Text></View>)
}

export default function MobileFIScreen() {
  const params = useLocalSearchParams<{ financed: string; unit: string; customer: string }>()
  const t = useTheme()
  const [name, setName] = useState(params.customer || '')
  const [products, setProducts] = useState<any[]>([])
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<any>(null)
  const [err, setErr] = useState('')

  useEffect(() => { get('/api/fi/products').then((r) => { if (r.ok) setProducts(r.data?.products || []) }) }, [])

  const base = Number(params.financed) || 0
  const productTotal = products.filter((p) => sel[p.id]).reduce((s, p) => s + p.price, 0)
  const amountFinanced = base + productTotal

  async function submit() {
    if (!name.trim()) { setErr('Enter the applicant name.'); return }
    setLoading(true); setErr(''); setRes(null)
    const r = await post('/api/fi/submit', { applicant: { name }, amountFinanced, products: products.filter((p) => sel[p.id]).map((p) => p.id) })
    if (r.ok && r.data?.result) setRes(r.data)
    else setErr(r.data?.error || r.error || 'Submit failed')
    setLoading(false)
  }

  const d = res?.result
  const decColor = d?.decision === 'approved' ? '#22c55e' : d?.decision === 'declined' ? '#ef4444' : '#f59e0b'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <Stack.Screen options={{ title: 'F&I' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[styles.lbl, { color: t.textSecondary }]}>Applicant</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Customer name" placeholderTextColor={t.textMuted} style={[styles.input, { color: t.text, borderColor: t.border }]} />
          {params.unit ? <Text style={[styles.unit, { color: t.textMuted }]}>{params.unit}</Text> : null}
        </View>

        <Text style={[styles.sectionTitle, { color: t.text }]}>F&I menu</Text>
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          {products.map((p) => (
            <TouchableOpacity key={p.id} onPress={() => setSel((s) => ({ ...s, [p.id]: !s[p.id] }))} style={styles.prodRow} activeOpacity={0.7}>
              <Ionicons name={sel[p.id] ? 'checkbox' : 'square-outline'} size={20} color={sel[p.id] ? t.primary : t.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.prodName, { color: t.text }]}>{p.name}</Text>
                <Text style={[styles.prodDesc, { color: t.textMuted }]}>{p.desc}</Text>
              </View>
              <Text style={[styles.prodPrice, { color: t.text }]}>{money(p.price)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={styles.amtRow}><Text style={{ color: t.textSecondary }}>Amount financed</Text><Text style={[styles.amt, { color: t.primary }]}>{money(amountFinanced)}</Text></View>
          <TouchableOpacity onPress={submit} disabled={loading} style={[styles.btn, { backgroundColor: t.primary, opacity: loading ? 0.6 : 1 }]}>
            {loading ? <ActivityIndicator color="#fff" /> : (
              <View style={styles.btnInner}><Ionicons name="send" size={16} color="#fff" /><Text style={styles.btnText}>Submit credit app</Text></View>
            )}
          </TouchableOpacity>
        </View>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        {d ? (
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, borderLeftWidth: 4, borderLeftColor: decColor }]}>
            <Text style={[styles.dec, { color: decColor }]}>{String(d.decision).toUpperCase()}</Text>
            <Text style={[styles.lender, { color: t.textSecondary }]}>{d.lender}</Text>
            {d.decision !== 'declined' ? (
              <View style={styles.terms}>
                <Term label="APR" v={d.apr + '%'} t={t} />
                <Term label="Term" v={d.termMonths + ' mo'} t={t} />
                <Term label="Approved" v={money(d.approvedAmount)} t={t} />
              </View>
            ) : <Text style={{ color: t.textSecondary, marginTop: 6 }}>{d.reason}</Text>}
            {d.stipulations?.length ? <Text style={[styles.stips, { color: t.textMuted }]}>Stips: {d.stipulations.join(', ')}</Text> : null}
            {!res.live ? <Text style={[styles.demo, { color: t.textMuted }]}>Demo decision — live via RouteOne / DealerTrack on integration.</Text> : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  lbl: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  unit: { fontSize: 12, marginTop: 6 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  prodRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  prodName: { fontSize: 14, fontWeight: '600' },
  prodDesc: { fontSize: 11, marginTop: 1 },
  prodPrice: { fontSize: 14, fontWeight: '600' },
  amtRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  amt: { fontSize: 20, fontWeight: '800' },
  btn: { borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  err: { color: '#ef4444', fontSize: 13, marginBottom: 12 },
  dec: { fontSize: 20, fontWeight: '800' },
  lender: { fontSize: 13, marginTop: 2 },
  terms: { flexDirection: 'row', gap: 10, marginTop: 12 },
  stips: { fontSize: 11, marginTop: 12 },
  demo: { fontSize: 10, marginTop: 10, fontStyle: 'italic' },
})
