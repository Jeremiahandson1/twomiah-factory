/**
 * Create / Edit Job form.
 * Route: /(details)/job/form                — create mode
 * Route: /(details)/job/form?id=xxx         — edit mode
 * Route: /(details)/job/form?contactId=yyy  — pre-select contact
 *
 * The two job modules take different bodies (apps/unified/server/modules/crm.ts):
 *   · the shared one (packages/tenant-backend jobs/jobs.ts jobSchema): title (required), description, contactId,
 *     address/city/state/zip, scheduledDate — a calendar DAY, YYYY-MM-DD — and scheduledTime "HH:MM" (24-hour), notes;
 *   · roofing's (server/crm/roof/jobs.ts jobSchema): contactId, jobType, propertyAddress, city, state and zip, all
 *     required on a create; the job's title IS its property address. Its notes are rows (POST /:id/notes), so an edit
 *     never sends `notes` — the detail screen adds them.
 * Creating needs jobs:create (the office); editing needs jobs:update (office and field).
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
import { useVertical } from '../../../src/vertical/VerticalContext'
import { get, post, put } from '../../../src/api/client'
import { SearchBar } from '../../../src/components/SearchBar'
import { AvatarCircle } from '../../../src/components/AvatarCircle'
import { FilterChips } from '../../../src/components/FilterChips'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useDebounce } from '../../../src/hooks/useDebounce'

/** The job types roofing's forms offer (web/src/crm/pages/roof/jobs/model.ts JOB_TYPES); the server takes any string. */
const ROOF_JOB_TYPES = [
  { key: 'insurance', label: 'Insurance' }, { key: 'retail', label: 'Retail' }, { key: 'commercial', label: 'Commercial' },
  { key: 'new_construction', label: 'New Build' }, { key: 'emergency', label: 'Emergency' },
]
const pad = (n: number) => String(n).padStart(2, '0')
/** The job's calendar day as the phone shows it — not toISOString(), which is the UTC day and moves an evening job. */
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

export default function JobFormScreen() {
  const { id, contactId: preContactId } = useLocalSearchParams<{ id?: string; contactId?: string }>()
  const isEdit = !!id
  const router = useRouter()
  const t = useTheme()
  const { vertical } = useVertical()
  const isRoof = vertical === 'roofing'
  const toast = useToast()
  const haptics = useHaptics()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [jobType, setJobType] = useState('retail')
  const [contactId, setContactId] = useState(preContactId || '')
  const [contactName, setContactName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [scheduledDate, setScheduledDate] = useState(new Date())
  const [hasTime, setHasTime] = useState(!isEdit)
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
        setContactName(j.contact?.name || '')
        setAddress(j.address || '')
        setCity(j.city || '')
        setState(j.state || '')
        setZip(j.zip || '')
        if (j.jobType) setJobType(j.jobType)
        if (j.scheduledDate) {
          // The stored day is a calendar marker (midnight UTC): read its Y-M-D, and the time from scheduledTime.
          const [y, m, d] = String(j.scheduledDate).slice(0, 10).split('-').map(Number)
          const at = new Date(y, m - 1, d)
          const hm = /^(\d{2}):(\d{2})$/.exec(j.scheduledTime || '')
          if (hm) { at.setHours(Number(hm[1]), Number(hm[2])); setHasTime(true) }
          setScheduledDate(at)
        }
        if (typeof j.notes === 'string') setNotes(j.notes)
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
        setContactName(c.name || '')
        if (c.address) { setAddress(c.address); setCity(c.city || ''); setState(c.state || ''); setZip(c.zip || '') }
      }
    })()
  }, [preContactId])

  // Search contacts for picker
  const searchContacts = useCallback(async () => {
    if (!debouncedSearch.trim()) { setContacts([]); return }
    setSearchingContacts(true)
    const res = await get(`/api/contacts?search=${encodeURIComponent(debouncedSearch)}&limit=10`)
    if (res.ok) setContacts(res.data?.data || [])
    setSearchingContacts(false)
  }, [debouncedSearch])

  useEffect(() => { searchContacts() }, [searchContacts])

  const selectContact = (c: any) => {
    setContactId(c.id)
    setContactName(c.name || '')
    if (c.address && !address) { setAddress(c.address); setCity(c.city || ''); setState(c.state || ''); setZip(c.zip || '') }
    contactSheetRef.current?.close()
  }

  const handleSave = async () => {
    let body: Record<string, unknown>
    if (isRoof) {
      if (!contactId) { toast.error('Pick the homeowner'); return }
      if (!address.trim() || !city.trim() || !state.trim() || !zip.trim()) { toast.error('The property address, city, state and ZIP are required'); return }
      body = {
        contactId,
        jobType,
        propertyAddress: address.trim(),
        city: city.trim(),
        state: state.trim(),
        zip: zip.trim(),
        // A new job's first note; after that, notes are added on the job.
        ...(!isEdit && notes.trim() ? { notes: notes.trim() } : {}),
      }
    } else {
      if (!title.trim()) { toast.error('Title is required'); return }
      // An edit sends '' for an emptied box, which the server reads as "clear it".
      const field = (v: string) => (v.trim() || (isEdit ? '' : undefined))
      body = {
        title: title.trim(),
        description: field(description),
        contactId: contactId || (isEdit ? '' : undefined),
        address: field(address),
        city: field(city),
        state: field(state),
        zip: field(zip),
        scheduledDate: dayOf(scheduledDate),
        scheduledTime: hasTime ? timeOf(scheduledDate) : (isEdit ? '' : undefined),
        notes: field(notes),
      }
    }
    setSaving(true)
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
          {isRoof ? (
            <>
              <Text style={[styles.label, { color: t.textMuted }]}>Job Type</Text>
              <FilterChips options={ROOF_JOB_TYPES.some(o => o.key === jobType) ? ROOF_JOB_TYPES : [...ROOF_JOB_TYPES, { key: jobType, label: jobType }]} selected={jobType} onSelect={setJobType} />
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: t.textMuted }]}>Title *</Text>
              <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={title} onChangeText={setTitle} placeholder="Job title" placeholderTextColor={t.textMuted} maxLength={200} />
            </>
          )}

          <Text style={[styles.label, { color: t.textMuted }]}>{isRoof ? 'Homeowner *' : 'Contact'}</Text>
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

          {!isRoof && (
            <>
              <Text style={[styles.label, { color: t.textMuted }]}>Description</Text>
              <TextInput style={[styles.input, styles.multiline, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={description} onChangeText={setDescription} placeholder="Description..." placeholderTextColor={t.textMuted}
                multiline numberOfLines={3} textAlignVertical="top" />
            </>
          )}

          <Text style={[styles.label, { color: t.textMuted }]}>{isRoof ? 'Property Address *' : 'Address'}</Text>
          <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={address} onChangeText={setAddress} placeholder="Street address" placeholderTextColor={t.textMuted} />

          <View style={styles.row}>
            <View style={{ flex: 2 }}>
              <Text style={[styles.label, { color: t.textMuted }]}>City{isRoof ? ' *' : ''}</Text>
              <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={t.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: t.textMuted }]}>State{isRoof ? ' *' : ''}</Text>
              <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={state} onChangeText={setState} placeholder="ST" placeholderTextColor={t.textMuted} autoCapitalize="characters" maxLength={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: t.textMuted }]}>ZIP{isRoof ? ' *' : ''}</Text>
              <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={zip} onChangeText={setZip} placeholder="00000" placeholderTextColor={t.textMuted} keyboardType="numbers-and-punctuation" maxLength={10} />
            </View>
          </View>

          {/* Roofing schedules an inspection and an install on the job's own screen, not one scheduled date. */}
          {!isRoof && (
            <>
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
                  <Text style={{ color: hasTime ? t.text : t.textMuted, fontSize: 15 }}>
                    {hasTime ? scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Any time'}
                  </Text>
                </TouchableOpacity>
              </View>
              {showDate && (
                <DateTimePicker value={scheduledDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_, d) => { setShowDate(Platform.OS === 'ios'); if (d) setScheduledDate(d) }} />
              )}
              {showTime && (
                <DateTimePicker value={scheduledDate} mode="time" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_, d) => { setShowTime(Platform.OS === 'ios'); if (d) { setScheduledDate(d); setHasTime(true) } }} />
              )}
            </>
          )}

          {(!isRoof || !isEdit) && (
            <>
              <Text style={[styles.label, { color: t.textMuted }]}>Notes</Text>
              <TextInput style={[styles.input, styles.multiline, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={notes} onChangeText={setNotes} placeholder="Notes..." placeholderTextColor={t.textMuted}
                multiline numberOfLines={3} textAlignVertical="top" />
            </>
          )}
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
                  <AvatarCircle name={item.name} size={32} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: t.text }}>{item.name}</Text>
                    {item.email ? <Text style={{ fontSize: 12, color: t.textMuted }}>{item.email}</Text> : null}
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
