/**
 * Delivery Driver Mode — active route view with stop management and GPS tracking.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity,
  Linking, Platform, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import { useTheme } from '../../src/theme/ThemeContext'
import { get, post, put } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { SwipeableRow } from '../../src/components/SwipeableRow'
import { EmptyState } from '../../src/components/EmptyState'
import { useToast } from '../../src/components/ToastProvider'
import { useHaptics } from '../../src/hooks/useHaptics'

const STOP_STATUS_ORDER = ['in_transit', 'arrived', 'delivering', 'delivered', 'skipped']

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: string }> = {
  in_transit: { bg: '#dbeafe', text: '#1d4ed8', icon: 'car' },
  arrived: { bg: '#fef3c7', text: '#b45309', icon: 'location' },
  delivering: { bg: '#f3e8ff', text: '#7c3aed', icon: 'bag-handle' },
  delivered: { bg: '#dcfce7', text: '#15803d', icon: 'checkmark-circle' },
  skipped: { bg: '#fee2e2', text: '#dc2626', icon: 'close-circle' },
}

export default function DriverScreen() {
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const [route, setRoute] = useState<any>(null)
  const [stops, setStops] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [trackingActive, setTrackingActive] = useState(false)
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const locationSubRef = useRef<Location.LocationSubscription | null>(null)

  const loadRoute = useCallback(async () => {
    const res = await get('/api/tracking/routes?status=active&driver=me')
    if (res.ok) {
      const routes = res.data.data || res.data || []
      if (routes.length > 0) {
        const activeRoute = routes[0]
        setRoute(activeRoute)
        setStops(activeRoute.stops || [])
      } else {
        setRoute(null)
        setStops([])
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadRoute() }, [loadRoute])

  const onRefresh = async () => { setRefreshing(true); await loadRoute(); setRefreshing(false) }

  // GPS location tracking
  const startTracking = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') {
      toast.error('Location permission is required for driver mode')
      return
    }
    setTrackingActive(true)
    haptics.success()
    toast.success('GPS tracking started')

    // Send location every 30 seconds
    const sendLocation = async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        await post('/api/tracking/location', {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          speed: loc.coords.speed,
          heading: loc.coords.heading,
          timestamp: new Date(loc.timestamp).toISOString(),
        })
      } catch {
        // Silently fail on individual location pings
      }
    }

    sendLocation() // Send immediately
    locationIntervalRef.current = setInterval(sendLocation, 30000)
  }

  const stopTracking = () => {
    if (locationIntervalRef.current) clearInterval(locationIntervalRef.current)
    if (locationSubRef.current) locationSubRef.current.remove()
    setTrackingActive(false)
    haptics.medium()
    toast.info('GPS tracking stopped')
  }

  useEffect(() => {
    return () => {
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current)
      if (locationSubRef.current) locationSubRef.current.remove()
    }
  }, [])

  const openMaps = (address: string) => {
    const encoded = encodeURIComponent(address)
    const url = Platform.OS === 'ios'
      ? `maps:?daddr=${encoded}`
      : `google.navigation:q=${encoded}`
    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`)
    })
  }

  const updateStop = async (stop: any, action: string) => {
    const res = await put(`/api/tracking/stops/${stop.id}/${action}`, {})
    if (res.ok) {
      haptics.success()
      toast.success(`Stop ${action}: ${stop.customerName || stop.address}`)
      loadRoute()
    } else {
      haptics.error()
      toast.error(res.error || `Failed to update stop`)
    }
  }

  const currentStop = stops.find(s => s.status === 'in_transit' || s.status === 'arrived')

  const renderStop = ({ item: stop, index }: { item: any; index: number }) => {
    const isCurrent = currentStop?.id === stop.id
    const statusStyle = STATUS_STYLES[stop.status] || STATUS_STYLES.in_transit

    const swipeActions: any[] = []
    if (stop.status === 'in_transit') {
      swipeActions.push({ icon: 'location', label: 'Arrived', color: '#f59e0b', onPress: () => updateStop(stop, 'arrived') })
    }
    if (stop.status === 'arrived') {
      swipeActions.push({ icon: 'bag-handle', label: 'Delivering', color: '#8b5cf6', onPress: () => updateStop(stop, 'delivering') })
    }
    if (stop.status === 'delivering' || stop.status === 'arrived') {
      swipeActions.push({ icon: 'checkmark-done', label: 'Delivered', color: '#22c55e', onPress: () => updateStop(stop, 'delivered') })
    }
    if (stop.status !== 'delivered' && stop.status !== 'skipped') {
      swipeActions.push({ icon: 'close', label: 'Skip', color: '#ef4444', onPress: () => updateStop(stop, 'skipped') })
    }

    return (
      <AnimatedCard index={index}>
        <SwipeableRow rightActions={swipeActions}>
          <View style={[
            styles.card,
            { backgroundColor: t.surface, borderColor: isCurrent ? t.primary : t.border },
            isCurrent && { borderWidth: 2 },
          ]}>
            {isCurrent && (
              <View style={[styles.currentBanner, { backgroundColor: t.primary }]}>
                <Ionicons name="navigate" size={12} color="#fff" />
                <Text style={styles.currentBannerText}>CURRENT STOP</Text>
              </View>
            )}
            <View style={styles.cardRow}>
              <View style={[styles.stopIndex, { backgroundColor: statusStyle.bg }]}>
                <Ionicons name={statusStyle.icon as any} size={16} color={statusStyle.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.customerName, { color: t.text }]} numberOfLines={1}>
                  {stop.customerName || 'Customer'}
                </Text>
                <Text style={[styles.address, { color: t.textSecondary }]} numberOfLines={2}>
                  {stop.address}
                </Text>
                <View style={styles.metaRow}>
                  {stop.orderNumber && (
                    <Text style={[styles.orderNum, { color: t.textMuted }]}>
                      Order #{stop.orderNumber}
                    </Text>
                  )}
                  <StatusBadge status={stop.status} />
                </View>
              </View>
            </View>

            {/* Action buttons */}
            {stop.status !== 'delivered' && stop.status !== 'skipped' && (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#3b82f6' }]}
                  onPress={() => openMaps(stop.address)}
                >
                  <Ionicons name="navigate" size={14} color="#fff" />
                  <Text style={styles.actionBtnText}>Navigate</Text>
                </TouchableOpacity>
                {stop.phone && (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#22c55e' }]}
                    onPress={() => Linking.openURL(`tel:${stop.phone}`)}
                  >
                    <Ionicons name="call" size={14} color="#fff" />
                    <Text style={styles.actionBtnText}>Call</Text>
                  </TouchableOpacity>
                )}
                {stop.status === 'in_transit' && (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#f59e0b' }]}
                    onPress={() => updateStop(stop, 'arrived')}
                  >
                    <Ionicons name="location" size={14} color="#fff" />
                    <Text style={styles.actionBtnText}>Arrived</Text>
                  </TouchableOpacity>
                )}
                {(stop.status === 'arrived' || stop.status === 'delivering') && (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#22c55e' }]}
                    onPress={() => updateStop(stop, 'delivered')}
                  >
                    <Ionicons name="checkmark-done" size={14} color="#fff" />
                    <Text style={styles.actionBtnText}>Delivered</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </SwipeableRow>
      </AnimatedCard>
    )
  }

  const completedCount = stops.filter(s => s.status === 'delivered').length

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Route Summary Header */}
      <View style={[styles.header, { backgroundColor: t.surface, borderBottomColor: t.border }]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.headerTitle, { color: t.text }]}>
            {route ? `Route: ${route.name || 'Active'}` : 'Delivery Mode'}
          </Text>
          <Text style={[styles.headerSub, { color: t.textSecondary }]}>
            {stops.length > 0 ? `${completedCount}/${stops.length} stops completed` : 'No active route'}
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.trackingBtn,
            { backgroundColor: trackingActive ? '#ef4444' : '#22c55e' },
          ]}
          onPress={trackingActive ? stopTracking : startTracking}
        >
          <Ionicons name={trackingActive ? 'stop' : 'radio'} size={16} color="#fff" />
          <Text style={styles.trackingBtnText}>
            {trackingActive ? 'Stop GPS' : 'Start GPS'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Progress bar */}
      {stops.length > 0 && (
        <View style={[styles.progressBar, { backgroundColor: t.border }]}>
          <View style={[styles.progressFill, { width: `${(completedCount / stops.length) * 100}%` }]} />
        </View>
      )}

      {loading ? (
        <SkeletonList count={4} />
      ) : (
        <FlatList
          data={stops}
          keyExtractor={item => item.id}
          renderItem={renderStop}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon="car-outline"
              title="No active route"
              subtitle="You'll see your delivery stops here when a route is assigned"
            />
          }
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerSub: { fontSize: 13, marginTop: 2 },
  trackingBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  trackingBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  progressBar: { height: 3 },
  progressFill: { height: 3, backgroundColor: '#22c55e' },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, overflow: 'hidden' },
  currentBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 4, marginHorizontal: -14, marginTop: -14, marginBottom: 10,
  },
  currentBannerText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stopIndex: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  customerName: { fontSize: 15, fontWeight: '600' },
  address: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  orderNum: { fontSize: 12 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
  },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
})
