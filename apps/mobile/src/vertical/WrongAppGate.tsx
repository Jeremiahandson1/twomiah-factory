/**
 * Shown when a tenant logs into a branded variant build (Twomiah Build / Roofer)
 * but their company is configured for a different vertical. Forces them to log
 * out so they can sign in via the correct branded app.
 */

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../theme/ThemeContext'
import { useVertical } from './VerticalContext'

const VERTICAL_LABEL: Record<string, string> = {
  contractor: 'Twomiah Build',
  roofing: 'Twomiah Roofer',
  fieldservice: 'Twomiah Field Service',
  homecare: 'Twomiah Care',
  landscaping: 'Twomiah Landscaping',
  dispensary: 'Twomiah Retail',
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
})
