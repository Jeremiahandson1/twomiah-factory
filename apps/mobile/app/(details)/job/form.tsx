/**
 * Create / Edit Job form.
 * Route: /(details)/job/form                — create mode
 * Route: /(details)/job/form?id=xxx         — edit mode
 * Route: /(details)/job/form?contactId=yyy  — pre-select contact
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
import { get, post, put } from '../../../src/api/client'
import { SearchBar } from '../../../src/components/SearchBar'
import { AvatarCircle } from '../../../src/components/AvatarCircle'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useDebounce } from '../../../src/hooks/useDebounce'

export default function JobFormScreen() {
  const { id, contactId: preContactId } = useLocalSearchParams<{ id?: string; contactId?: string }>()
  const isEdit = !!id
  const router = useRouter()
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [contactId, setContactId] = useState(preContactId || '')
  const [contactName, setContactName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [scheduledDate, setScheduledDate] = useState(new Date())
  const [showDate, setShowDate] = useState(false)
  const [showTime, setShowTime] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingData, setLoadingData] = useState(isEdit)

  // Contact picker
  const contactSheetRef = React.useRef<BottomSheet>(null)
  const [contactSearch, setContactSearch] = useState('')
  const debouncedSearch = useDebounce(contactSearch)
  const [contacts, setContacts] = useState<any[]>([])
  const [searchingContacts, setSearchingContacts] = useState(false)

  // Load existing job for edit
  useEffect(() => {
    if (!isEdit) return
    ;(async () => {
      const res = await get(`/api/jobs/${id}`)
      if (res.ok) {
        const j = res.data
        setTitle(j.title || '')
        setDescription(j.description || '')
        setContactId(j.contactId || '')
        setContactName(j.contact?.name || [j.contact?.firstName, j.contact?.lastName].filter(Boolean).join(' ') || '')
        setAddress(j.address || '')
        setCity(j.city || '')
        setState(j.state || '')
        setZip(j.zip || '')
        if (j.scheduledDate) setScheduledDate(new Date(j.scheduledDate))
        setNotes(j.notes || '')
      }
      setLoadingData(false)
    })()
  }, [id, isEdit])

  // Load pre-selected contact
  useEffect(() => {
    if (!preContactId) return
    ;(async () => {
      const res = await get(`/api/contacts/${preContactId}`)
      if (res.ok) {
        const c = res.data
        setContactName(c.name || [c.firstName, c.lastName].filter(Boolean).join(' '))
        if (c.address) { setAddress(c.address); setCity(c.city || ''); setState(c.state || ''); setZip(c.zip || '') }
      }
    })()
  }, [preContactId])

  // Search contacts for picker
  const searchContacts = useCallback(async () => {
    if (!debouncedSearch.trim()) { setContacts([]); return }
    setSearchingContacts(true)
    const res = await get(`/api/contacts?search=${encodeURIComponent(debouncedSearch)}&limit=10`)
    if (res.ok) setContacts(res.data.data || res.data || [])
    setSearchingContacts(false)
  }, [debouncedSearch])

  useEffect(() => { searchContacts() }, [searchContacts])

  const selectContact = (c: any) => {
    setContactId(c.id)
    setContactName(c.name || [c.firstName, c.lastName].filter(Boolean).join(' '))
    if (c.address && !address) { setAddress(c.address); setCity(c.city || ''); setState(c.state || ''); setZip(c.zip || '') }
    contactSheetRef.current?.close()
  }

  const handleSave = async () => {
    if (!title.trim()) { toast.error('Title is required'); return }
    setSaving(true)
    const body: any = {
      title: title.trim(),
      description: description.trim() || undefined,
      contactId: contactId || undefined,
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      zip: zip.trim() || undefined,
      scheduledDate: scheduledDate.toISOString(),
      notes: notes.trim() || undefined,
    }
    const res = isEdit
      ? await put(`/api/jobs/${id}`, body)
      : await post('/api/jobs', body)
    setSaving(false)
    if (res.ok) {
      haptics.success()
      toast.success(isEdit ? 'Job updated' : 'Job created')
      if (isEdit) { router.back() }
      else {
        const newId = res.data?.id
        if (newId) router.replace(`/(details)/job/${newId}`)
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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <Stack.Screen options={{
        title: isEdit ? 'Edit Job' : 'New Job',
        headerRight: () => (
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={t.primary} /> : <Text style={{ color: t.primary, fontSize: 16, fontWeight: '600' }}>Save</Text>}
          </TouchableOpacity>
        ),
      }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: t.textMuted }]}>Title *</Text>
          <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={title} onChangeText={setTitle} placeholder="Job title" placeholderTextColor={t.textMuted} />

          <Text style={[styles.label, { color: t.textMuted }]}>Contact</Text>
          <TouchableOpacity
            style={[styles.input, styles.contactPicker, { backgroundColor: t.surface, borderColor: t.border }]}
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

          <Text style={[styles.label, { color: t.textMuted }]}>Description</Text>
          <TextInput style={[styles.input, styles.multiline, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={description} onChangeText={setDescription} placeholder="Description..." placeholderTextColor={t.textMuted}
            multiline numberOfLines={3} textAlignVertical="top" />

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

          <Text style={[styles.label, { color: t.textMuted }]}>Scheduled Date & Time</Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.input, styles.dateBtn, { flex: 1, backgroundColor: t.surface, borderColor: t.border }]}
              onPress={() => setShowDate(true)}>
              <Ionicons name="calendar-outline" size={16} color={t.textMuted} />
              <Text style={{ color: t.text, fontSize: 15 }}>{scheduledDate.toLocaleDateString()}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.input, styles.dateBtn, { flex: 1, backgroundColor: t.surface, borderColor: t.border }]}
              onPress={() => setShowTime(true)}>
              <Ionicons name="time-outline" size={16} color={t.textMuted} />
              <Text style={{ color: t.text, fontSize: 15 }}>{scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            </TouchableOpacity>
          </View>
          {showDate && (
            <DateTimePicker value={scheduledDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, d) => { setShowDate(Platform.OS === 'ios'); if (d) setScheduledDate(d) }} />
          )}
          {showTime && (
            <DateTimePicker value={scheduledDate} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, d) => { setShowTime(Platform.OS === 'ios'); if (d) setScheduledDate(d) }} />
          )}

          <Text style={[styles.label, { color: t.textMuted }]}>Notes</Text>
          <TextInput style={[styles.input, styles.multiline, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={notes} onChangeText={setNotes} placeholder="Notes..." placeholderTextColor={t.textMuted}
            multiline numberOfLines={3} textAlignVertical="top" />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Contact Picker Bottom Sheet */}
      <BottomSheet
        ref={contactSheetRef}
        index={-1}
        snapPoints={[400]}
        enablePanDownToClose
        backgroundStyle={{ backgroundColor: t.surface }}
        handleIndicatorStyle={{ backgroundColor: t.textMuted }}
      >
        <BottomSheetView style={{ flex: 1, padding: 16 }}>
          <SearchBar value={contactSearch} onChangeText={setContactSearch} placeholder="Search contacts..." />
          {searchingContacts ? (
            <ActivityIndicator style={{ marginTop: 20 }} color={t.primary} />
          ) : (
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
                    {item.email && <Text style={{ fontSize: 12, color: t.textMuted }}>{item.email}</Text>}
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                debouncedSearch.trim() ? <Text style={{ color: t.textMuted, textAlign: 'center', marginTop: 20 }}>No contacts found</Text> : null
              }
            />
          )}
        </BottomSheetView>
      </BottomSheet>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginTop: 16, marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  multiline: { minHeight: 80, paddingTop: 12 },
  row: { flexDirection: 'row', gap: 10 },
  contactPicker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contactItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0' },
})
