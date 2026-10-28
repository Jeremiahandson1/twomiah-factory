/**
 * Shown when a tenant logs into a branded variant build (Twomiah Build / Roofer)
 * but their company is configured for a different vertical. Forces them to log
 * out so they can sign in via the correct branded app.
 */

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../theme/ThemeContext'
import { useVertical } from './VerticalContext'
import { getApiUrl } from '../api/client'
import { webSignInUrl } from './verticals'
import { inkOn } from '../theme/contrast'

const VERTICAL_LABEL: Record<string, string> = {
  contractor: 'Twomiah Build',
  roofing: 'Twomiah Roofer',
  fieldservice: 'Twomiah Field Service',
  homecare: 'Twomiah Care',
  landscaping: 'Twomiah Landscaping',
  basic: 'Twomiah Build',
  rv: 'the Twomiah app',
}

/**
 * Shown when the business's industry has no phone screens (bar, salon, vet, restaurant, store — verticals.ts `unavailable`).
 * Plain about it, and never a dead end: it opens the website sign-in in the phone's browser (same email and password), and
 * there is still Sign Out, for a person who has more than one business.
 */
export function NoPhoneAppGate() {
  const t = useTheme()
  const { logout, company } = useAuth()
  const url = webSignInUrl(getApiUrl())
  const name = company?.name || 'Your business'
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]}>
      <View style={styles.container}>
        <View style={[styles.iconCircle, { backgroundColor: t.primaryLight }]}>
          <Ionicons name="desktop-outline" size={36} color={t.primary} />
        </View>
        <Text style={[styles.title, { color: t.text }]}>{name} uses the website</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          This app is for crews who work away from a desk: contractors, home care, roofing, landscaping, field service and RV
          sales. {name} runs on the Twomiah website instead, which works in your phone's browser with the same email and password.
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: t.primary }]}
          onPress={() => { Linking.openURL(url).catch(() => {}) }}
          activeOpacity={0.85}
          accessibilityRole="link"
          accessibilityLabel="Open the website sign-in in your browser"
        >
          <Text style={[styles.buttonText, { color: inkOn(t.primary) }]}>Open the website sign-in</Text>
        </TouchableOpacity>
        <Text style={[styles.address, { color: t.textSecondary }]} selectable>{url.replace(/^https?:\/\//, '')}</Text>
        <TouchableOpacity style={styles.secondary} onPress={logout} activeOpacity={0.7} accessibilityRole="button">
          <Text style={[styles.secondaryText, { color: t.text }]}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

export function WrongAppGate() {
  const t = useTheme()
  const { logout, company } = useAuth()
  const { lockedVertical } = useVertical()

  const tenantVertical = company?.vertical
  const expectedApp = tenantVertical ? VERTICAL_LABEL[tenantVertical] : 'a different Twomiah app'
  const thisApp = lockedVertical ? VERTICAL_LABEL[lockedVertical] : 'this app'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]}>
      <View style={styles.container}>
        <View style={[styles.iconCircle, { backgroundColor: t.primaryLight }]}>
          <Ionicons name="swap-horizontal" size={36} color={t.primary} />
        </View>
        <Text style={[styles.title, { color: t.text }]}>Wrong app for this account</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          {company?.name || 'This company'} is set up for{' '}
          <Text style={{ fontWeight: '700', color: t.text }}>{expectedApp}</Text>, but you're
          signed in to <Text style={{ fontWeight: '700', color: t.text }}>{thisApp}</Text>.
        </Text>
        <Text style={[styles.body, { color: t.textSecondary, marginTop: 12 }]}>
          Sign out and use the {expectedApp} app instead.
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: t.primary }]}
          onPress={logout}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  iconCircle: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  body: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  button: {
    marginTop: 32, paddingVertical: 14, paddingHorizontal: 32,
    borderRadius: 10, minWidth: 180, alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  address: { marginTop: 12, fontSize: 13 },
  secondary: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 24 },
  secondaryText: { fontSize: 15, fontWeight: '600' },
})
