/**
 * Create / Edit Contact form.
 * Route: /(details)/contact/form         — create mode
 * Route: /(details)/contact/form?id=xxx  — edit mode
 */

import React, { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../../src/theme/ThemeContext'
import { useVertical } from '../../../src/vertical/VerticalContext'
import { get, post, put } from '../../../src/api/client'
import { FilterChips } from '../../../src/components/FilterChips'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'

const TYPE_OPTIONS: Record<string, { key: string; label: string }[]> = {
  contractor: [{ key: 'lead', label: 'Lead' }, { key: 'client', label: 'Client' }, { key: 'subcontractor', label: 'Subcontractor' }, { key: 'vendor', label: 'Vendor' }],
  fieldservice: [{ key: 'lead', label: 'Lead' }, { key: 'client', label: 'Client' }, { key: 'vendor', label: 'Vendor' }],
  homecare: [{ key: 'client', label: 'Client' }, { key: 'caregiver', label: 'Caregiver' }, { key: 'referral', label: 'Referral' }],
  roofing: [{ key: 'lead', label: 'Lead' }, { key: 'client', label: 'Client' }, { key: 'subcontractor', label: 'Sub' }, { key: 'vendor', label: 'Vendor' }],
  dispensary: [{ key: 'customer', label: 'Customer' }, { key: 'vendor', label: 'Vendor' }],
}

export default function ContactFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const isEdit = !!id
  const router = useRouter()
  const t = useTheme()
  const { vertical } = useVertical()
  const toast = useToast()
  const haptics = useHaptics()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [type, setType] = useState('lead')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingData, setLoadingData] = useState(isEdit)

  useEffect(() => {
    if (!isEdit) return
    ;(async () => {
      const res = await get(`/api/contacts/${id}`)
      if (res.ok) {
        const c = res.data
        setFirstName(c.firstName || '')
        setLastName(c.lastName || '')
        setEmail(c.email || '')
        setPhone(c.phone || '')
        setCompany(c.company || '')
        setAddress(c.address || '')
        setCity(c.city || '')
        setState(c.state || '')
        setZip(c.zip || '')
        setType(c.type || 'lead')
        setNotes(c.notes || '')
      }
      setLoadingData(false)
    })()
  }, [id, isEdit])

  const handleSave = async () => {
    if (!firstName.trim()) { toast.error('First name is required'); return }
    setSaving(true)
    const body = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      company: company.trim() || undefined,
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      zip: zip.trim() || undefined,
      type,
      notes: notes.trim() || undefined,
    }
    const res = isEdit
      ? await put(`/api/contacts/${id}`, body)
      : await post('/api/contacts', body)
    setSaving(false)
    if (res.ok) {
      haptics.success()
      toast.success(isEdit ? 'Contact updated' : 'Contact created')
      if (isEdit) {
        router.back()
      } else {
        const newId = res.data?.id
        if (newId) router.replace(`/(details)/contact/${newId}`)
        else router.back()
      }
    } else {
      haptics.error()
      toast.error(res.error || 'Save failed')
    }
  }

  if (loadingData) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <View style={styles.centered}><ActivityIndicator size="large" color={t.primary} /></View>
      </SafeAreaView>
    )
  }

  const types = TYPE_OPTIONS[vertical] || TYPE_OPTIONS.contractor

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <Stack.Screen options={{
        title: isEdit ? 'Edit Contact' : 'New Contact',
        headerRight: () => (
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={t.primary} /> : <Text style={{ color: t.primary, fontSize: 16, fontWeight: '600' }}>Save</Text>}
          </TouchableOpacity>
        ),
      }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: t.textMuted }]}>Type</Text>
          <FilterChips options={types} selected={type} onSelect={setType} />

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: t.textMuted }]}>First Name *</Text>
              <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={firstName} onChangeText={setFirstName} placeholder="First" placeholderTextColor={t.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: t.textMuted }]}>Last Name</Text>
              <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={lastName} onChangeText={setLastName} placeholder="Last" placeholderTextColor={t.textMuted} />
            </View>
          </View>

          <Text style={[styles.label, { color: t.textMuted }]}>Email</Text>
          <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={email} onChangeText={setEmail} placeholder="email@example.com" placeholderTextColor={t.textMuted}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />

          <Text style={[styles.label, { color: t.textMuted }]}>Phone</Text>
          <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={phone} onChangeText={setPhone} placeholder="(555) 123-4567" placeholderTextColor={t.textMuted}
            keyboardType="phone-pad" />

          <Text style={[styles.label, { color: t.textMuted }]}>Company</Text>
          <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={company} onChangeText={setCompany} placeholder="Company name" placeholderTextColor={t.textMuted} />

          <Text style={[styles.label, { color: t.textMuted }]}>Address</Text>
          <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={address} onChangeText={setAddress} placeholder="Street address" placeholderTextColor={t.textMuted} />

          <View style={styles.row}>
            <View style={{ flex: 2 }}>
              <Text style={[styles.label, { color: t.textMuted }]}>City</Text>
              <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={t.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: t.textMuted }]}>State</Text>
              <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={state} onChangeText={setState} placeholder="ST" placeholderTextColor={t.textMuted} autoCapitalize="characters" maxLength={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: t.textMuted }]}>ZIP</Text>
              <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={zip} onChangeText={setZip} placeholder="00000" placeholderTextColor={t.textMuted} keyboardType="number-pad" maxLength={5} />
            </View>
          </View>

          <Text style={[styles.label, { color: t.textMuted }]}>Notes</Text>
          <TextInput style={[styles.input, styles.multiline, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={notes} onChangeText={setNotes} placeholder="Notes..." placeholderTextColor={t.textMuted}
            multiline numberOfLines={4} textAlignVertical="top" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginTop: 16, marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  multiline: { minHeight: 100, paddingTop: 12 },
  row: { flexDirection: 'row', gap: 10 },
})
