/**
 * Create Quote form with dynamic line items.
 * Route: /(details)/quote/form?contactId=yyy
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, FlatList,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import DateTimePicker from '@react-native-community/datetimepicker'
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet'
import { useTheme } from '../../../src/theme/ThemeContext'
import { get, post } from '../../../src/api/client'
import { SearchBar } from '../../../src/components/SearchBar'
import { AvatarCircle } from '../../../src/components/AvatarCircle'
import { SwipeableRow } from '../../../src/components/SwipeableRow'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useDebounce } from '../../../src/hooks/useDebounce'

interface LineItem {
  key: string
  description: string
  quantity: string
  rate: string
}

export default function QuoteFormScreen() {
  const { contactId: preContactId } = useLocalSearchParams<{ contactId?: string }>()
  const router = useRouter()
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()

  const [name, setName] = useState('')
  const [contactId, setContactId] = useState(preContactId || '')
  const [contactName, setContactName] = useState('')
  const [expiryDate, setExpiryDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 30); return d })
  const [showDate, setShowDate] = useState(false)
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([{ key: '1', description: '', quantity: '1', rate: '' }])
  const [saving, setSaving] = useState(false)

  // Contact picker
  const contactSheetRef = React.useRef<BottomSheet>(null)
  const [contactSearch, setContactSearch] = useState('')
  const debouncedSearch = useDebounce(contactSearch)
  const [contacts, setContacts] = useState<any[]>([])

  useEffect(() => {
    if (!preContactId) return
    ;(async () => {
      const res = await get(`/api/contacts/${preContactId}`)
      if (res.ok) setContactName(res.data.name || [res.data.firstName, res.data.lastName].filter(Boolean).join(' '))
    })()
  }, [preContactId])

  const searchContacts = useCallback(async () => {
    if (!debouncedSearch.trim()) { setContacts([]); return }
    const res = await get(`/api/contacts?search=${encodeURIComponent(debouncedSearch)}&limit=10`)
    if (res.ok) setContacts(res.data.data || res.data || [])
  }, [debouncedSearch])
  useEffect(() => { searchContacts() }, [searchContacts])

  const selectContact = (c: any) => {
    setContactId(c.id)
    setContactName(c.name || [c.firstName, c.lastName].filter(Boolean).join(' '))
    contactSheetRef.current?.close()
  }

  const addLine = () => {
    setItems(prev => [...prev, { key: String(Date.now()), description: '', quantity: '1', rate: '' }])
  }

  const updateLine = (key: string, field: keyof LineItem, value: string) => {
    setItems(prev => prev.map(i => i.key === key ? { ...i, [field]: value } : i))
  }

  const removeLine = (key: string) => {
    if (items.length <= 1) return
    haptics.light()
    setItems(prev => prev.filter(i => i.key !== key))
  }

  const subtotal = items.reduce((sum, i) => {
    const qty = parseFloat(i.quantity) || 0
    const rate = Math.round(parseFloat(i.rate) * 100) || 0
    return sum + qty * rate
  }, 0)

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Quote name is required'); return }
    if (!contactId) { toast.error('Select a contact'); return }
    const lineItems = items.filter(i => i.description.trim()).map(i => ({
      description: i.description.trim(),
      quantity: parseFloat(i.quantity) || 1,
      rate: Math.round((parseFloat(i.rate) || 0) * 100),
    }))
    if (lineItems.length === 0) { toast.error('Add at least one line item'); return }

    setSaving(true)
    const res = await post('/api/quotes', {
      name: name.trim(),
      contactId,
      expiryDate: expiryDate.toISOString(),
      notes: notes.trim() || undefined,
      items: lineItems,
    })
    setSaving(false)
    if (res.ok) {
      haptics.success()
      toast.success('Quote created')
      const newId = res.data?.id
      if (newId) router.replace(`/(details)/quote/${newId}`)
      else router.back()
    } else {
      haptics.error()
      toast.error(res.error || 'Save failed')
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <Stack.Screen options={{
        title: 'New Quote',
        headerRight: () => (
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={t.primary} /> : <Text style={{ color: t.primary, fontSize: 16, fontWeight: '600' }}>Save</Text>}
          </TouchableOpacity>
        ),
      }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: t.textMuted }]}>Quote Name *</Text>
          <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={name} onChangeText={setName} placeholder="e.g. Kitchen Remodel" placeholderTextColor={t.textMuted} />

          <Text style={[styles.label, { color: t.textMuted }]}>Contact *</Text>
          <TouchableOpacity
            style={[styles.input, styles.picker, { backgroundColor: t.surface, borderColor: t.border }]}
            onPress={() => contactSheetRef.current?.expand()}
          >
            {contactName ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <AvatarCircle name={contactName} size={24} />
                <Text style={{ color: t.text, fontSize: 15 }}>{contactName}</Text>
              </View>
            ) : (
              <Text style={{ color: t.textMuted, fontSize: 15 }}>Select contact...</Text>
            )}
            <Ionicons name="chevron-down" size={18} color={t.textMuted} />
          </TouchableOpacity>

          <Text style={[styles.label, { color: t.textMuted }]}>Expires</Text>
          <TouchableOpacity style={[styles.input, styles.dateBtn, { backgroundColor: t.surface, borderColor: t.border }]}
            onPress={() => setShowDate(true)}>
            <Ionicons name="calendar-outline" size={16} color={t.textMuted} />
            <Text style={{ color: t.text, fontSize: 15 }}>{expiryDate.toLocaleDateString()}</Text>
          </TouchableOpacity>
          {showDate && (
            <DateTimePicker value={expiryDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minimumDate={new Date()}
              onChange={(_, d) => { setShowDate(Platform.OS === 'ios'); if (d) setExpiryDate(d) }} />
          )}

          {/* Line Items */}
          <View style={styles.lineHeader}>
            <Text style={[styles.label, { color: t.textMuted, marginTop: 0 }]}>Line Items *</Text>
            <TouchableOpacity onPress={addLine} style={styles.addLineBtn}>
              <Ionicons name="add-circle" size={20} color={t.primary} />
              <Text style={{ color: t.primary, fontSize: 13, fontWeight: '600' }}>Add Line</Text>
            </TouchableOpacity>
          </View>
          {items.map((item, idx) => (
            <SwipeableRow
              key={item.key}
              rightActions={items.length > 1 ? [{ icon: 'trash', label: 'Remove', color: '#ef4444', onPress: () => removeLine(item.key) }] : []}
            >
              <View style={[styles.lineCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                <TextInput
                  style={[styles.lineInput, { color: t.text, borderColor: t.border }]}
                  value={item.description}
                  onChangeText={v => updateLine(item.key, 'description', v)}
                  placeholder="Description"
                  placeholderTextColor={t.textMuted}
                />
                <View style={styles.lineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: t.textMuted }}>QTY</Text>
                    <TextInput
                      style={[styles.lineInput, styles.lineSmall, { color: t.text, borderColor: t.border }]}
                      value={item.quantity}
                      onChangeText={v => updateLine(item.key, 'quantity', v)}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: t.textMuted }}>RATE ($)</Text>
                    <TextInput
                      style={[styles.lineInput, styles.lineSmall, { color: t.text, borderColor: t.border }]}
                      value={item.rate}
                      onChangeText={v => updateLine(item.key, 'rate', v)}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={t.textMuted}
                    />
                  </View>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 11, color: t.textMuted }}>AMOUNT</Text>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: t.text, marginTop: 10 }}>
                      ${(((parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0))).toFixed(2)}
                    </Text>
                  </View>
                </View>
              </View>
            </SwipeableRow>
          ))}

          {/* Totals */}
          <View style={[styles.totals, { borderTopColor: t.border }]}>
            <View style={styles.totalRow}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: t.text }}>Total</Text>
              <Text style={{ fontSize: 16, fontWeight: '700', color: t.text }}>${(subtotal / 100).toFixed(2)}</Text>
            </View>
          </View>

          <Text style={[styles.label, { color: t.textMuted }]}>Notes / Terms</Text>
          <TextInput style={[styles.input, styles.multiline, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={notes} onChangeText={setNotes} placeholder="Notes or terms..." placeholderTextColor={t.textMuted}
            multiline numberOfLines={3} textAlignVertical="top" />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Contact Picker */}
      <BottomSheet ref={contactSheetRef} index={-1} snapPoints={[400]} enablePanDownToClose
        backgroundStyle={{ backgroundColor: t.surface }} handleIndicatorStyle={{ backgroundColor: t.textMuted }}>
        <BottomSheetView style={{ flex: 1, padding: 16 }}>
          <SearchBar value={contactSearch} onChangeText={setContactSearch} placeholder="Search contacts..." />
          <FlatList
            data={contacts}
            keyExtractor={item => item.id}
            style={{ marginTop: 8 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.contactItem} onPress={() => selectContact(item)}>
                <AvatarCircle name={item.name || [item.firstName, item.lastName].filter(Boolean).join(' ')} size={32} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: t.text }}>
                    {item.name || [item.firstName, item.lastName].filter(Boolean).join(' ')}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </BottomSheetView>
      </BottomSheet>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginTop: 16, marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  multiline: { minHeight: 80, paddingTop: 12 },
  picker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 8 },
  addLineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lineCard: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  lineInput: { borderBottomWidth: 1, paddingVertical: 6, fontSize: 14 },
  lineSmall: { marginTop: 4 },
  lineRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  totals: { borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  contactItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0' },
})
