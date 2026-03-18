/**
 * Contacts — searchable list with type badges, tap to call/email.
 * Adapts label and filters per vertical.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { get, post } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { SearchBar } from '../../src/components/SearchBar'
import { FilterChips } from '../../src/components/FilterChips'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { SwipeableRow } from '../../src/components/SwipeableRow'
import { AvatarCircle } from '../../src/components/AvatarCircle'
import { EmptyState } from '../../src/components/EmptyState'
import { useToast } from '../../src/components/ToastProvider'
import { useDebounce } from '../../src/hooks/useDebounce'
import { useHaptics } from '../../src/hooks/useHaptics'
import { useRealTimeEvent, EVENTS } from '../../src/socket/SocketContext'

const VERTICAL_FILTERS: Record<string, { key: string; label: string }[]> = {
  contractor: [
    { key: 'all', label: 'All' }, { key: 'lead', label: 'Lead' }, { key: 'client', label: 'Client' },
    { key: 'subcontractor', label: 'Sub' }, { key: 'vendor', label: 'Vendor' },
  ],
  fieldservice: [
    { key: 'all', label: 'All' }, { key: 'lead', label: 'Lead' }, { key: 'client', label: 'Customer' },
    { key: 'vendor', label: 'Vendor' },
  ],
  homecare: [
    { key: 'all', label: 'All' }, { key: 'client', label: 'Client' },
  ],
  roofing: [
    { key: 'all', label: 'All' }, { key: 'lead', label: 'Lead' }, { key: 'client', label: 'Homeowner' },
    { key: 'subcontractor', label: 'Adjuster' },
  ],
  dispensary: [
    { key: 'all', label: 'All' },
  ],
}

export default function ContactsScreen() {
  const t = useTheme()
  const { vertical } = useVertical()
  const toast = useToast()
  const haptics = useHaptics()
  const [contacts, setContacts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  const filters = VERTICAL_FILTERS[vertical] || VERTICAL_FILTERS.contractor

  const loadContacts = useCallback(async (p = 1, append = false) => {
    const params = new URLSearchParams({ page: String(p), limit: '25' })
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    const endpoint = vertical === 'homecare' ? '/api/clients' : '/api/contacts'
    const res = await get(`${endpoint}?${params}`)
    if (res.ok) {
      const data = res.data.data || res.data
      if (append) setContacts(prev => [...prev, ...data])
      else setContacts(data)
      setHasMore(data.length === 25)
    }
    setLoading(false)
  }, [typeFilter, debouncedSearch, vertical])

  useEffect(() => { setLoading(true); setPage(1); loadContacts(1) }, [loadContacts])

  const onRefresh = async () => { setRefreshing(true); await loadContacts(1); setRefreshing(false) }
  const loadMore = () => { if (hasMore) { setPage(p => p + 1); loadContacts(page + 1, true) } }

  useRealTimeEvent(EVENTS.CONTACT_CREATED, () => loadContacts(1))
  useRealTimeEvent(EVENTS.CONTACT_UPDATED, () => loadContacts(1))

  const handleConvert = async (contact: any) => {
    haptics.medium()
    const res = await post(`/api/contacts/${contact.id}/convert`)
    if (res.ok) {
      toast.success(`${contact.name} converted to client`)
      setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, type: 'client' } : c))
    } else {
      toast.error(res.error || 'Conversion failed')
    }
  }

  const renderContact = ({ item: contact, index }: { item: any; index: number }) => {
    const swipeActions = []
    if (contact.phone) {
      swipeActions.push({ icon: 'call', label: 'Call', color: '#22c55e', onPress: () => Linking.openURL(`tel:${contact.phone}`) })
    }
    if (contact.email) {
      swipeActions.push({ icon: 'mail', label: 'Email', color: '#3b82f6', onPress: () => Linking.openURL(`mailto:${contact.email}`) })
    }

    return (
      <AnimatedCard index={index}>
        <SwipeableRow rightActions={swipeActions}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.row}>
              <AvatarCircle name={contact.name} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: t.text }]}>{contact.name}</Text>
                {contact.company && <Text style={[styles.sub, { color: t.textSecondary }]}>{contact.company}</Text>}
              </View>
              {contact.type && <StatusBadge status={contact.type} />}
            </View>

            <View style={styles.quickActions}>
              {contact.phone && (
                <TouchableOpacity style={[styles.qBtn, { borderColor: t.border }]} onPress={() => Linking.openURL(`tel:${contact.phone}`)}>
                  <Ionicons name="call" size={14} color="#22c55e" />
                  <Text style={[styles.qLabel, { color: t.textSecondary }]}>{contact.phone}</Text>
                </TouchableOpacity>
              )}
              {contact.email && (
                <TouchableOpacity style={[styles.qBtn, { borderColor: t.border }]} onPress={() => Linking.openURL(`mailto:${contact.email}`)}>
                  <Ionicons name="mail" size={14} color="#3b82f6" />
                  <Text style={[styles.qLabel, { color: t.textSecondary }]} numberOfLines={1}>{contact.email}</Text>
                </TouchableOpacity>
              )}
              {contact.type === 'lead' && (
                <TouchableOpacity style={[styles.qBtn, { borderColor: '#22c55e' }]} onPress={() => handleConvert(contact)}>
                  <Ionicons name="arrow-forward-circle" size={14} color="#22c55e" />
                  <Text style={[styles.qLabel, { color: '#22c55e' }]}>Convert</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </SwipeableRow>
      </AnimatedCard>
    )
  }

  const placeholder = vertical === 'homecare' ? 'Search clients...'
    : vertical === 'dispensary' ? 'Search customers...'
    : 'Search contacts...'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <SearchBar value={search} onChangeText={setSearch} placeholder={placeholder} />
      {filters.length > 1 && (
        <FilterChips options={filters} selected={typeFilter} onSelect={setTypeFilter} />
      )}

      {loading ? (
        <SkeletonList count={6} />
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
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 12, marginTop: 1 },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  qBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
  },
  qLabel: { fontSize: 12 },
})
