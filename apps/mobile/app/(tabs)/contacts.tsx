/**
 * Contacts — searchable list with type badges, tap to call/email.
 * Adapts label and filters per vertical.
 *
 * GET /api/contacts (packages/tenant-backend contacts/contacts.ts) is { data, pagination }; ?type must be one of the
 * vertical's contact types or it is a 400 (checkFilter), so each vertical's chips are only the types it has. Adding a
 * contact needs contacts:create and converting a lead contacts:update — the office's, not the field seat's.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, Linking,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { ACTION } from '../../src/theme/actions'
import { useVertical } from '../../src/vertical/VerticalContext'
import { get, post } from '../../src/api/client'
import { useAuth } from '../../src/auth/AuthContext'
import { StatusBadge } from '../../src/components/StatusBadge'
import { SearchBar } from '../../src/components/SearchBar'
import { FilterChips } from '../../src/components/FilterChips'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { SwipeableRow } from '../../src/components/SwipeableRow'
import { AvatarCircle } from '../../src/components/AvatarCircle'
import { FAB } from '../../src/components/FAB'
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
  basic: [
    { key: 'all', label: 'All' }, { key: 'lead', label: 'Lead' }, { key: 'client', label: 'Client' },
    { key: 'vendor', label: 'Supplier' },
  ],
  fieldservice: [
    { key: 'all', label: 'All' }, { key: 'lead', label: 'Lead' }, { key: 'client', label: 'Customer' },
    { key: 'vendor', label: 'Vendor' },
  ],
  landscaping: [
    { key: 'all', label: 'All' }, { key: 'lead', label: 'Lead' }, { key: 'client', label: 'Customer' },
    { key: 'vendor', label: 'Vendor' },
  ],
  // A dealership's types are lead / customer / vendor (verticals/rv settings.ts crm.contacts.types).
  rv: [
    { key: 'all', label: 'All' }, { key: 'lead', label: 'Lead' }, { key: 'customer', label: 'Customer' },
    { key: 'vendor', label: 'Vendor' },
  ],
  homecare: [
    { key: 'all', label: 'All' }, { key: 'client', label: 'Client' },
  ],
  roofing: [
    { key: 'all', label: 'All' }, { key: 'lead', label: 'Lead' }, { key: 'client', label: 'Homeowner' },
    { key: 'subcontractor', label: 'Sub' }, { key: 'vendor', label: 'Vendor' },
  ],
}

export default function ContactsScreen() {
  const router = useRouter()
  const t = useTheme()
  const { vertical } = useVertical()
  const toast = useToast()
  const haptics = useHaptics()
  const { can } = useAuth()
  const canCreate = can('contacts:create')
  const canConvert = can('contacts:update')
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
      const data: any[] = Array.isArray(res.data?.data) ? res.data.data : []
      if (append) setContacts(prev => [...prev, ...data])
      else setContacts(data)
      setHasMore(data.length === 25)
    }
    setLoading(false)
  }, [typeFilter, debouncedSearch, vertical])

  useEffect(() => { setLoading(true); setPage(1); loadContacts(1) }, [loadContacts])

  const onRefresh = async () => { setRefreshing(true); await loadContacts(1); setRefreshing(false) }
  const loadMore = () => { if (hasMore) { setPage(p => p + 1); loadContacts(page + 1, true) } }

  useRealTimeEvent(EVENTS.CONTACT_CREATED, () => loadContacts(1), [loadContacts])
  useRealTimeEvent(EVENTS.CONTACT_UPDATED, () => loadContacts(1), [loadContacts])

  const handleConvert = async (contact: any) => {
    haptics.medium()
    const res = await post(`/api/contacts/${contact.id}/convert`)
    if (res.ok) {
      // What a lead becomes is the vertical's (client, or a dealership's customer): the server says.
      toast.success(`${contact.name} converted to ${res.data?.type || 'customer'}`)
      setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, type: res.data?.type ?? c.type } : c))
    } else {
      toast.error(res.error || 'Conversion failed')
    }
  }

  const renderContact = ({ item: contact, index }: { item: any; index: number }) => {
    const swipeActions = []
    if (contact.phone) {
      swipeActions.push({ icon: 'call', label: 'Call', color: ACTION.slate, onPress: () => Linking.openURL(`tel:${contact.phone}`) })
    }
    if (contact.email) {
      swipeActions.push({ icon: 'mail', label: 'Email', color: ACTION.slate, onPress: () => Linking.openURL(`mailto:${contact.email}`) })
    }

    return (
      <AnimatedCard index={index}>
        <SwipeableRow rightActions={swipeActions}>
          <TouchableOpacity style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}
            onPress={() => router.push(`/(details)/contact/${contact.id}`)} activeOpacity={0.7}>
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
              {contact.type === 'lead' && canConvert && (
                <TouchableOpacity style={[styles.qBtn, { borderColor: t.primary }]} onPress={() => handleConvert(contact)}>
                  <Ionicons name="arrow-forward-circle" size={14} color="#22c55e" />
                  <Text style={[styles.qLabel, { color: t.primaryText }]}>Convert</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </SwipeableRow>
      </AnimatedCard>
    )
  }

  const placeholder = vertical === 'homecare' ? 'Search clients...'
    : vertical === 'rv' ? 'Search customers...'
    : 'Search contacts...'

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
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

      {canCreate && <FAB icon="add" onPress={() => router.push('/(details)/contact/form')} />}
    </View>
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
