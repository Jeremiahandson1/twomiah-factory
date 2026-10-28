/**
 * More — everything else in the caregiver's day (home care vertical): shifts to pick up, swaps and
 * requests, call-outs and incidents, documents to sign, mileage, notifications, clients, visit
 * history, payday verification, Sandata help, and reaching the office.
 */
import React from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { useAuth } from '../../src/auth/AuthContext'
import { useHaptics } from '../../src/hooks/useHaptics'
import { useToast } from '../../src/components/ToastProvider'
import { useCare } from '../../src/care/CareContext'
import { needsSandata } from '../../src/care/sandata'
import { Badge, SOLID } from '../../src/care/ui'

interface Item { icon: string; label: string; desc: string; to?: string; onPress?: () => void; badge?: number }

export default function MoreHomecareScreen() {
  const t = useTheme()
  const router = useRouter()
  const { logout, company, user } = useAuth()
  const haptics = useHaptics()
  const toast = useToast()
  const care = useCare()

  const email = (company as any)?.email as string | undefined
  const phone = (company as any)?.phone as string | undefined
  const sections: { title: string; items: Item[] }[] = [
    {
      title: 'Shifts',
      items: [
        { icon: 'briefcase-outline', label: 'Open shifts', desc: 'Pick up extra visits', to: '/(care)/open-shifts' },
        { icon: 'swap-horizontal', label: 'Shift swaps', desc: 'Swaps you asked for and swaps asked of you', to: '/(care)/swaps', badge: care.incomingSwaps.length },
        { icon: 'git-compare-outline', label: 'Requests', desc: 'Visits you asked to move, and client requests', to: '/(care)/requests', badge: care.clientRequests.length },
        { icon: 'alert-circle-outline', label: "Can't make a shift", desc: 'Tell the office so they can find coverage', to: '/(care)/shift-action?kind=miss' },
        { icon: 'time-outline', label: 'Visit history', desc: 'Your recent visits and hours', to: '/(care)/history' },
      ],
    },
    {
      title: 'Care',
      items: [
        { icon: 'people-outline', label: 'My clients', desc: 'Addresses, directions, care plans', to: '/(care)/clients' },
        { icon: 'warning-outline', label: 'Report an incident', desc: 'Falls, injuries, medication problems, anything unsafe', to: '/(care)/incident' },
        { icon: 'create-outline', label: 'Documents to sign', desc: 'Policies and forms from your agency', to: '/(care)/documents', badge: care.unsignedDocs.length },
        { icon: 'car-outline', label: 'Mileage', desc: 'Log miles driven for work', to: '/(care)/mileage' },
      ],
    },
    {
      title: 'You',
      items: [
        { icon: 'notifications-outline', label: 'Notifications', desc: 'Updates from your agency', to: '/(care)/notifications', badge: care.unreadNotifications },
        ...(care.payday ? [{ icon: 'cash-outline', label: 'Confirm your hours', desc: 'Payday verification for the last pay period', to: '/(care)/payday', badge: 1 }] : []),
        ...(care.sandata?.clients?.some(needsSandata) ? [{ icon: 'phone-portrait-outline', label: 'Sandata help', desc: 'Setting up Sandata Mobile Connect', to: '/(care)/sandata-help' }] : []),
      ],
    },
    {
      title: 'Everything else',
      items: [
        { icon: 'apps-outline', label: 'All menu items', desc: 'Every page your agency gives you on the full site', to: '/(tabs)/more' },
      ],
    },
    {
      title: 'Your office',
      items: [
        { icon: 'chatbubbles-outline', label: 'Message the office', desc: 'Send a message in the app', to: '/(care)/compose' },
        {
          icon: 'call-outline', label: 'Call the office', desc: phone || 'No phone number on file',
          onPress: () => { if (phone) Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`); else toast.info('Your agency has no phone number on file.') },
        },
        {
          icon: 'mail-outline', label: 'Email the office', desc: email || 'No email on file',
          onPress: () => { if (email) Linking.openURL(`mailto:${email}`); else toast.info('Your agency has no email on file.') },
        },
      ],
    },
  ]

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.background }} contentContainerStyle={styles.scroll}>
      <View style={[styles.me, { backgroundColor: t.surface, borderColor: t.border }]}>
        <Ionicons name="person-circle" size={44} color={t.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.meName, { color: t.text }]}>{user?.firstName} {user?.lastName}</Text>
          <Text style={[styles.meSub, { color: t.textSecondary }]}>{company?.name || 'Your agency'}</Text>
        </View>
      </View>
      {sections.filter((s) => s.items.length).map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: t.textSecondary }]}>{section.title}</Text>
          <View style={[styles.sectionCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            {section.items.map((item, idx) => (
              <TouchableOpacity
                key={item.label}
                style={[styles.menuItem, idx < section.items.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border }]}
                onPress={() => { haptics.light(); if (item.onPress) item.onPress(); else if (item.to) router.push(item.to as any) }}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <View style={[styles.iconBg, { backgroundColor: t.primaryLight }]}>
                  <Ionicons name={item.icon as any} size={19} color={t.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: t.text }]}>{item.label}</Text>
                  <Text style={[styles.desc, { color: t.textSecondary }]}>{item.desc}</Text>
                </View>
                <Badge count={item.badge || 0} />
                <Ionicons name="chevron-forward" size={18} color={t.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.logoutBtn, { borderColor: SOLID.danger }]}
        onPress={() => {
          haptics.medium()
          if (care.active || care.pendingPunches > 0) {
            Alert.alert(
              'Sign out?',
              care.active
                ? "You're still clocked in. Signing out does not clock you out — the visit stays open until you sign back in and clock out."
                : 'Some punches are still saved on this phone. They stay here and send the next time you sign in on this phone.',
              [{ text: 'Stay signed in', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => logout() }],
            )
            return
          }
          logout()
        }}
        accessibilityRole="button"
      >
        <Ionicons name="log-out-outline" size={18} color={t.isDark ? '#fca5a5' : SOLID.danger} />
        <Text style={[styles.logoutText, { color: t.isDark ? '#fca5a5' : SOLID.danger }]}>Sign out</Text>
      </TouchableOpacity>
      <Text style={[styles.version, { color: t.textSecondary }]}>{(Constants.expoConfig?.extra as any)?.appName || 'Twomiah'} {Constants.expoConfig?.version || ''}</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },
  me: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 18 },
  meName: { fontSize: 17, fontWeight: '800' },
  meSub: { fontSize: 14, marginTop: 2 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 },
  sectionCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  iconBg: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15, fontWeight: '600' },
  desc: { fontSize: 13, marginTop: 1 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 10, borderWidth: 1, marginTop: 8 },
  logoutText: { fontSize: 15, fontWeight: '700' },
  version: { textAlign: 'center', fontSize: 12, marginTop: 14 },
})
