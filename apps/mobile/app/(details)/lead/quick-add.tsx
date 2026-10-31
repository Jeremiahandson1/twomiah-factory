/**
 * Quick Add Lead — a roofing lead in two taps: GPS fills the address, the camera takes the property photo.
 *
 * A roofing lead is a homeowner (POST /api/contacts { name, phone, email, address…, type: 'lead', source, notes } —
 * packages/tenant-backend contacts/contacts.ts) and a roofing job at the `lead` stage on the pipeline (POST /api/jobs
 * { contactId, jobType, propertyAddress, city, state, zip, source, notes } — server/crm/roof/jobs.ts, where all four
 * address parts are required). The photo goes on that job. POST /api/leads, which this screen used, is the website's
 * public enquiry form: it filed a "website enquiry" in the Lead Inbox, not a lead on the board.
 * Needs contacts:create and jobs:create (the office); the pipeline only offers this screen to a seat that has both.
 */

import React, { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image, Alert,
} from 'react-native'
import { useRouter, Stack } from 'expo-router'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../../src/theme/ThemeContext'
import { post } from '../../../src/api/client'
import { uploadJobPhoto } from '../../../src/components/PhotoGallery'
import type { PhotoStamp } from '../../../src/photos/stamp'
import { FilterChips } from '../../../src/components/FilterChips'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useLocation } from '../../../src/hooks/useLocation'
import { useVertical } from '../../../src/vertical/VerticalContext'
import { useCamera } from '../../../src/hooks/useCamera'

const SOURCES = [
  { key: 'door_knock', label: 'Door Knock' },
  { key: 'referral', label: 'Referral' },
  { key: 'yard_sign', label: 'Yard Sign' },
  { key: 'storm', label: 'Storm' },
  { key: 'other', label: 'Other' },
]

export default function QuickAddLeadScreen() {
  const router = useRouter()
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const { requestLocation, loading: locLoading } = useLocation()
  const { vertical } = useVertical()
  const { takePhoto } = useCamera()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [source, setSource] = useState('door_knock')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<{ uri: string; stamp?: PhotoStamp } | null>(null)
  const [saving, setSaving] = useState(false)

  // Auto-fill address from GPS on mount
  useEffect(() => {
    ;(async () => {
      const loc = await requestLocation()
      if (!loc) return
      // Try reverse geocode — expo-location's built-in geocoder, no API key needed
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude: loc.latitude, longitude: loc.longitude })
        if (place) {
          const street = [place.streetNumber, place.street].filter(Boolean).join(' ')
          if (street) setAddress(street)
          if (place.city) setCity(place.city)
          if (place.region) setState(place.region)
          if (place.postalCode) setZip(place.postalCode)
        }
      } catch { /* reverse geocode failed, user fills manually */ }
    })()
  }, [])

  const handleTakePhoto = async () => {
    const result = await takePhoto()
    if (result) {
      haptics.light()
      setPhoto(result)
    }
  }

  /** The job on the pipeline for this homeowner, then its photo. */
  const addToPipeline = async (contactId: string) => {
    const sourceLabel = SOURCES.find(o => o.key === source)?.label || source
    const res = await post('/api/jobs', {
      contactId,
      // A storm lead is an insurance job; every other door is a retail one (the web form's default).
      jobType: source === 'storm' ? 'insurance' : 'retail',
      propertyAddress: address.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      source: sourceLabel,
      notes: notes.trim() || undefined,
    })
    if (!res.ok) {
      haptics.error()
      toast.error(`The homeowner was saved, but the job was not: ${res.error || 'try again from Jobs'}`)
      setSaving(false)
      return
    }
    if (photo && res.data?.id) {
      const up = await uploadJobPhoto(vertical, res.data.id, photo.uri, photo.stamp)
      if (!up.ok) toast.error(`Lead added; the photo did not upload (${up.error || 'try again on the job'})`)
    }
    haptics.success()
    toast.success('Lead added')
    setSaving(false)
    if (res.data?.id) router.replace(`/(details)/job/${res.data.id}`)
    else router.back()
  }

  const handleSave = async (allowDuplicate = false) => {
    if (!name.trim()) { toast.error('Name is required'); return }
    if (!phone.trim()) { toast.error('Phone is required'); return }
    if (!address.trim() || !city.trim() || !state.trim() || !zip.trim()) { toast.error('The property address, city, state and ZIP are needed for the pipeline'); return }

    setSaving(true)
    const res = await post('/api/contacts', {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || undefined,
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      type: 'lead',
      source: SOURCES.find(o => o.key === source)?.label || source,
      notes: notes.trim() || undefined,
      ...(allowDuplicate ? { allowDuplicate: true } : {}),
    })
    if (res.ok && res.data?.id) { await addToPipeline(res.data.id); return }
    setSaving(false)
    if (res.status === 409 && res.data?.existingId) {
      // This phone or email is already a homeowner: put the job on them, or save a second record anyway.
      Alert.alert('Already a contact', res.error || 'Someone already has this phone or email.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Use existing', onPress: () => { setSaving(true); addToPipeline(res.data.existingId) } },
        { text: 'Save anyway', onPress: () => handleSave(true) },
      ])
      return
    }
    haptics.error()
    toast.error(res.error || 'Save failed')
  }

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <Stack.Screen options={{
        title: 'Quick Add Lead',
        headerRight: () => (
          <TouchableOpacity onPress={() => handleSave()} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={t.primary} /> : <Text style={{ color: t.primaryText, fontSize: 16, fontWeight: '600' }}>Save</Text>}
          </TouchableOpacity>
        ),
      }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: t.textMuted }]}>Source</Text>
          <FilterChips options={SOURCES} selected={source} onSelect={setSource} />

          <Text style={[styles.label, { color: t.textMuted }]}>Name *</Text>
          <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={t.textMuted}
            autoFocus />

          <Text style={[styles.label, { color: t.textMuted }]}>Phone *</Text>
          <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={phone} onChangeText={setPhone} placeholder="(555) 123-4567" placeholderTextColor={t.textMuted}
            keyboardType="phone-pad" />

          <Text style={[styles.label, { color: t.textMuted }]}>Email</Text>
          <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={email} onChangeText={setEmail} placeholder="Optional" placeholderTextColor={t.textMuted}
            keyboardType="email-address" autoCapitalize="none" />

          <Text style={[styles.label, { color: t.textMuted }]}>
            Address {locLoading ? '(detecting...)' : ''}
          </Text>
          <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={address} onChangeText={setAddress} placeholder="Street address" placeholderTextColor={t.textMuted} />

          <View style={styles.row}>
            <View style={{ flex: 2 }}>
              <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={t.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={state} onChangeText={setState} placeholder="ST" placeholderTextColor={t.textMuted} autoCapitalize="characters" maxLength={2} />
            </View>
            <View style={{ flex: 1 }}>
              <TextInput style={[styles.input, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
                value={zip} onChangeText={setZip} placeholder="ZIP" placeholderTextColor={t.textMuted} keyboardType="number-pad" maxLength={5} />
            </View>
          </View>

          <Text style={[styles.label, { color: t.textMuted }]}>Notes</Text>
          <TextInput style={[styles.input, styles.multiline, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
            value={notes} onChangeText={setNotes} placeholder="Quick notes..." placeholderTextColor={t.textMuted}
            multiline numberOfLines={2} textAlignVertical="top" />

          {/* Photo */}
          <Text style={[styles.label, { color: t.textMuted }]}>Property Photo</Text>
          {photo ? (
            <TouchableOpacity onPress={handleTakePhoto}>
              <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
              <Text style={{ color: t.primaryText, fontSize: 12, textAlign: 'center', marginTop: 4 }}>Tap to retake</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.photoBtn, { borderColor: t.border }]} onPress={handleTakePhoto}>
              <Ionicons name="camera" size={28} color={t.textMuted} />
              <Text style={{ color: t.textMuted, fontSize: 13 }}>Take Photo</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginTop: 16, marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  multiline: { minHeight: 60, paddingTop: 12 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  photoBtn: {
    borderWidth: 2, borderStyle: 'dashed', borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 28,
  },
  photoPreview: { width: '100%', height: 200, borderRadius: 12 },
})
