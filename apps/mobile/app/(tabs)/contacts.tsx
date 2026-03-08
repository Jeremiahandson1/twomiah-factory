/**
 * Contacts — searchable list with type badges, tap to call/email.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
  ActivityIndicator, TextInput, Linking, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get, post } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { EmptyState } from '../../src/components/EmptyState'
import { useRealTimeEvent, EVENTS } from '../../src/socket/SocketContext'

const TYPE_FILTERS = ['all', 'lead', 'client', 'subcontractor', 'vendor'] as const

export default function ContactsScreen() {
  const t = useTheme()
  const [contacts, setContacts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  const loadContacts = useCallback(async (p = 1, append = false) => {
    const params = new URLSearchParams({ page: String(p), limit: '25' })
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (search.trim()) params.set('search', search.trim())
    const res = await get(`/api/contacts?${params}`)
    if (res.ok) {
      const data = res.data.data || res.data
      if (append) setContacts(prev => [...prev, ...data])
      else setContacts(data)
      setHasMore(data.length === 25)
    }
    setLoading(false)
  }, [typeFilter, search])

  useEffect(() => { setLoading(true); setPage(1); loadContacts(1) }, [loadContacts])

  const onRefresh = async () => { setRefreshing(true); await loadContacts(1); setRefreshing(false) }
  const loadMore = () => { if (hasMore) { setPage(p => p + 1); loadContacts(page + 1, true) } }

  useRealTimeEvent(EVENTS.CONTACT_CREATED, () => loadContacts(1))
  useRealTimeEvent(EVENTS.CONTACT_UPDATED, () => loadContacts(1))

  const handleConvert = async (contact: any) => {
    Alert.alert('Convert to Client', `Convert "${contact.name}" from lead to client?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Convert', style: 'default',
        onPress: async () => {
          const res = await post(`/api/contacts/${contact.id}/convert`)
          if (res.ok) {
            setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, type: 'client' } : c))
          }
        },
      },
    ])
  }

  const renderContact = ({ item: contact }: { item: any }) => (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: t.primaryLight }]}>
          <Text style={[styles.avatarText, { color: t.primary }]}>
            {(contact.name || '?')[0].toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: t.text }]}>{contact.name}</Text>
          {contact.company && <Text style={[styles.sub, { color: t.textSecondary }]}>{contact.company}</Text>}
        </View>
        <StatusBadge status={contact.type} />
      </View>

      {/* Quick actions */}
      <View style={styles.quickActions}>
        {contact.phone && (
          <TouchableOpacity style={[styles.qBtn, { borderColor: t.border }]} onPress={() => Linking.openURL(`tel:${contact.phone}`)}>
            <Ionicons name="call" size={16} color="#22c55e" />
            <Text style={[styles.qLabel, { color: t.textSecondary }]}>{contact.phone}</Text>
          </TouchableOpacity>
        )}
        {contact.email && (
          <TouchableOpacity style={[styles.qBtn, { borderColor: t.border }]} onPress={() => Linking.openURL(`mailto:${contact.email}`)}>
            <Ionicons name="mail" size={16} color="#3b82f6" />
            <Text style={[styles.qLabel, { color: t.textSecondary }]} numberOfLines={1}>{contact.email}</Text>
          </TouchableOpacity>
        )}
        {contact.type === 'lead' && (
          <TouchableOpacity style={[styles.qBtn, { borderColor: '#22c55e' }]} onPress={() => handleConvert(contact)}>
            <Ionicons name="arrow-forward-circle" size={16} color="#22c55e" />
            <Text style={[styles.qLabel, { color: '#22c55e' }]}>Convert</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Search */}
      <View style={[styles.searchWrap, { backgroundColor: t.surface, borderColor: t.border }]}>
        <Ionicons name="search" size={18} color={t.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: t.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search contacts..."
          placeholderTextColor={t.textMuted}
          returnKeyType="search"
        />
      </View>

      {/* Type filters */}
      <View style={styles.filters}>
        {TYPE_FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, typeFilter === f && { backgroundColor: t.primary }]}
            onPress={() => setTypeFilter(f)}
          >
            <Text style={[styles.filterText, typeFilter === f && { color: '#fff' }, typeFilter !== f && { color: t.textSecondary }]}>
              {f === 'all' ? 'All' : f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={t.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={item => item.id}
          renderItem={renderContact}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No contacts found" />}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16,
    marginTop: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15 },
  filters: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  filterText: { fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700' },
  name: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 12, marginTop: 1 },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  qBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  qLabel: { fontSize: 12 },
})
