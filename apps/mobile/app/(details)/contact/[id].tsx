/**
 * Contact Detail — view contact info, quick actions, related jobs/quotes/invoices.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Linking, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../../src/theme/ThemeContext'
import { useVertical } from '../../../src/vertical/VerticalContext'
import { get, del } from '../../../src/api/client'
import { StatusBadge } from '../../../src/components/StatusBadge'
import { AvatarCircle } from '../../../src/components/AvatarCircle'
import { SkeletonList } from '../../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../../src/components/AnimatedCard'
import { ConfirmSheet } from '../../../src/components/ConfirmSheet'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useRealTimeEvent, EVENTS } from '../../../src/socket/SocketContext'

export default function ContactDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const t = useTheme()
  const { vertical } = useVertical()
  const toast = useToast()
  const haptics = useHaptics()
  const [contact, setContact] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  const load = useCallback(async () => {
    const res = await get(`/api/contacts/${id}`)
    if (res.ok) setContact(res.data)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  useRealTimeEvent(EVENTS.CONTACT_UPDATED, load)

  const handleDelete = async () => {
    const res = await del(`/api/contacts/${id}`)
    if (res.ok) {
      haptics.success()
      toast.success('Contact deleted')
      router.back()
    } else {
      haptics.error()
      toast.error(res.error || 'Delete failed')
    }
  }

  const handleConvert = async () => {
    const res = await (await import('../../../src/api/client')).post(`/api/contacts/${id}/convert`)
    if (res.ok) {
      haptics.success()
      toast.success('Converted to client')
      load()
    } else {
      haptics.error()
      toast.error(res.error || 'Conversion failed')
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Contact' }} />
        <SkeletonList count={4} />
      </SafeAreaView>
    )
  }

  if (!contact) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
        <Stack.Screen options={{ title: 'Contact' }} />
        <View style={styles.centered}>
          <Text style={{ color: t.textMuted }}>Contact not found</Text>
        </View>
      </SafeAreaView>
    )
  }

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.name || 'Unknown'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <Stack.Screen options={{
        title: name,
        headerRight: () => (
          <TouchableOpacity onPress={() => router.push(`/(details)/contact/form?id=${id}`)}>
            <Ionicons name="create-outline" size={22} color={t.text} />
          </TouchableOpacity>
        ),
      }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        {/* Header */}
        <AnimatedCard index={0}>
          <View style={[styles.header, { backgroundColor: t.surface, borderColor: t.border }]}>
            <AvatarCircle name={name} avatar={contact.avatar} size={56} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: t.text }]}>{name}</Text>
              {contact.company && <Text style={[styles.company, { color: t.textSecondary }]}>{contact.company}</Text>}
              <StatusBadge status={contact.type || 'lead'} />
            </View>
          </View>
        </AnimatedCard>

        {/* Quick Actions */}
        <AnimatedCard index={1}>
          <View style={styles.actionsRow}>
            {contact.phone && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: t.surface, borderColor: t.border }]}
                onPress={() => Linking.openURL(`tel:${contact.phone}`)}>
                <Ionicons name="call" size={20} color="#22c55e" />
                <Text style={[styles.actionLabel, { color: t.text }]}>Call</Text>
              </TouchableOpacity>
            )}
            {contact.email && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: t.surface, borderColor: t.border }]}
                onPress={() => Linking.openURL(`mailto:${contact.email}`)}>
                <Ionicons name="mail" size={20} color="#3b82f6" />
                <Text style={[styles.actionLabel, { color: t.text }]}>Email</Text>
              </TouchableOpacity>
            )}
            {contact.phone && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: t.surface, borderColor: t.border }]}
                onPress={() => Linking.openURL(`sms:${contact.phone}`)}>
                <Ionicons name="chatbubble" size={20} color="#8b5cf6" />
                <Text style={[styles.actionLabel, { color: t.text }]}>SMS</Text>
              </TouchableOpacity>
            )}
            {contact.address && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: t.surface, borderColor: t.border }]}
                onPress={() => {
                  const addr = encodeURIComponent(`${contact.address}, ${contact.city || ''} ${contact.state || ''} ${contact.zip || ''}`)
                  Linking.openURL(`https://maps.google.com/?q=${addr}`)
                }}>
                <Ionicons name="navigate" size={20} color="#f59e0b" />
                <Text style={[styles.actionLabel, { color: t.text }]}>Map</Text>
              </TouchableOpacity>
            )}
          </View>
        </AnimatedCard>

        {/* Info Card */}
        <AnimatedCard index={2}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Details</Text>
            {contact.phone && <InfoRow icon="call-outline" label="Phone" value={contact.phone} t={t} />}
            {contact.email && <InfoRow icon="mail-outline" label="Email" value={contact.email} t={t} />}
            {contact.address && (
              <InfoRow icon="location-outline" label="Address"
                value={[contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ')} t={t} />
            )}
            {contact.source && <InfoRow icon="link-outline" label="Source" value={contact.source} t={t} />}
            {contact.notes && <InfoRow icon="document-text-outline" label="Notes" value={contact.notes} t={t} />}
            {contact.createdAt && (
              <InfoRow icon="calendar-outline" label="Created" value={new Date(contact.createdAt).toLocaleDateString()} t={t} />
            )}
          </View>
        </AnimatedCard>

        {/* Related Jobs */}
        {contact.jobs?.length > 0 && (
          <AnimatedCard index={3}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Recent Jobs</Text>
              {contact.jobs.slice(0, 3).map((job: any) => (
                <TouchableOpacity key={job.id} style={styles.relatedRow}
                  onPress={() => router.push(`/(details)/job/${job.id}`)}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.relatedTitle, { color: t.text }]}>{job.title}</Text>
                    <Text style={[styles.relatedSub, { color: t.textMuted }]}>{job.number}</Text>
                  </View>
                  <StatusBadge status={job.status} />
                </TouchableOpacity>
              ))}
            </View>
          </AnimatedCard>
        )}

        {/* Related Quotes */}
        {contact.quotes?.length > 0 && (
          <AnimatedCard index={4}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Recent Quotes</Text>
              {contact.quotes.slice(0, 3).map((quote: any) => (
                <TouchableOpacity key={quote.id} style={styles.relatedRow}
                  onPress={() => router.push(`/(details)/quote/${quote.id}`)}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.relatedTitle, { color: t.text }]}>{quote.name || quote.number}</Text>
                    <Text style={[styles.relatedSub, { color: t.textMuted }]}>${((quote.total || 0) / 100).toFixed(2)}</Text>
                  </View>
                  <StatusBadge status={quote.status} />
                </TouchableOpacity>
              ))}
            </View>
          </AnimatedCard>
        )}

        {/* Related Invoices */}
        {contact.invoices?.length > 0 && (
          <AnimatedCard index={5}>
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Recent Invoices</Text>
              {contact.invoices.slice(0, 3).map((inv: any) => (
                <TouchableOpacity key={inv.id} style={styles.relatedRow}
                  onPress={() => router.push(`/(details)/invoice/${inv.id}`)}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.relatedTitle, { color: t.text }]}>{inv.number}</Text>
                    <Text style={[styles.relatedSub, { color: t.textMuted }]}>${((inv.total || 0) / 100).toFixed(2)}</Text>
                  </View>
                  <StatusBadge status={inv.status} />
                </TouchableOpacity>
              ))}
            </View>
          </AnimatedCard>
        )}

        {/* Convert to Client (roofing leads) */}
        {(contact.type === 'lead') && (
          <AnimatedCard index={6}>
            <TouchableOpacity style={[styles.convertBtn, { backgroundColor: t.primary }]} onPress={handleConvert}>
              <Ionicons name="arrow-forward-circle" size={20} color="#fff" />
              <Text style={styles.convertText}>Convert to Client</Text>
            </TouchableOpacity>
          </AnimatedCard>
        )}

        {/* Delete */}
        <AnimatedCard index={7}>
          <TouchableOpacity style={styles.deleteBtn} onPress={() => setShowDelete(true)}>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
            <Text style={styles.deleteText}>Delete Contact</Text>
          </TouchableOpacity>
        </AnimatedCard>
      </ScrollView>

      <ConfirmSheet
        visible={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Delete Contact"
        description="This will permanently delete this contact and cannot be undone."
        confirmLabel="Delete"
        destructive
      />
    </SafeAreaView>
  )
}

function InfoRow({ icon, label, value, t }: { icon: string; label: string; value: string; t: any }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon as any} size={16} color={t.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.infoLabel, { color: t.textMuted }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: t.text }]}>{value}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 12,
  },
  name: { fontSize: 20, fontWeight: '700' },
  company: { fontSize: 14, marginTop: 2, marginBottom: 4 },
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  actionBtn: {
    flex: 1, alignItems: 'center', gap: 4,
    paddingVertical: 12, borderRadius: 10, borderWidth: 1,
  },
  actionLabel: { fontSize: 11, fontWeight: '600' },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  infoRow: { flexDirection: 'row', gap: 10, marginBottom: 12, alignItems: 'flex-start' },
  infoLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  infoValue: { fontSize: 14, marginTop: 1 },
  relatedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0',
  },
  relatedTitle: { fontSize: 14, fontWeight: '600' },
  relatedSub: { fontSize: 12, marginTop: 1 },
  convertBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10, marginBottom: 12,
  },
  convertText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, marginBottom: 20,
  },
  deleteText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
})
