/**
 * Screen scaffolding and device links for the caregiver screens.
 */
import React from 'react'
import { ScrollView, RefreshControl, Linking, Platform, View, StyleSheet, KeyboardAvoidingView } from 'react-native'
import { useTheme } from '../theme/ThemeContext'

export function CareScreen({ children, refreshing, onRefresh, keyboard, scrollEnabled = true }: {
  children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; keyboard?: boolean; scrollEnabled?: boolean
}) {
  const t = useTheme()
  const body = (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      scrollEnabled={scrollEnabled}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.primary} colors={[t.primary]} /> : undefined}
    >
      {children}
    </ScrollView>
  )
  if (!keyboard) return body
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {body}
    </KeyboardAvoidingView>
  )
}

export function Spacer({ h = 12 }: { h?: number }) { return <View style={{ height: h }} /> }

export const fullAddress = (c: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null } | null | undefined) =>
  c ? [c.address, [c.city, c.state].filter(Boolean).join(', '), c.zip].filter((x) => x && String(x).trim()).join(' ').trim() : ''

/** Turn-by-turn directions in the phone's maps app (falls back to Google Maps on the web). */
export async function openDirections(address: string) {
  const q = encodeURIComponent(address)
  const native = Platform.OS === 'ios' ? `maps://?daddr=${q}` : `google.navigation:q=${q}`
  try { await Linking.openURL(native) } catch {
    try { await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}`) } catch { /* nothing to open with */ }
  }
}

export async function callNumber(phone: string) {
  const tel = String(phone).replace(/[^\d+]/g, '')
  if (tel) { try { await Linking.openURL(`tel:${tel}`) } catch { /* no dialer */ } }
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
})
