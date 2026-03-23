/**
 * More — dispensary navigation menu with links to secondary screens.
 */

import React from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { useAuth } from '../../src/auth/AuthContext'
import { useHaptics } from '../../src/hooks/useHaptics'

interface MenuItem {
  icon: string
  color: string
  label: string
  desc: string
  route: string
}

const MENU_SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Front of House',
    items: [
      { icon: 'people', color: '#3b82f6', label: 'Check-In Queue', desc: 'Manage customer waiting queue', route: '/(tabs)/checkin-queue' },
      { icon: 'chatbubble-ellipses', color: '#8b5cf6', label: 'AI Budtender Chat', desc: 'AI-powered product recommendations', route: '/(tabs)/ai-chat' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { icon: 'car', color: '#06b6d4', label: 'Delivery Driver Mode', desc: 'Active route & delivery tracking', route: '/(tabs)/driver' },
      { icon: 'cash', color: '#22c55e', label: 'Cash Management', desc: 'Open/close drawers, count cash', route: '/(tabs)/cash-management' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { icon: 'bar-chart', color: '#f59e0b', label: 'Analytics', desc: 'Sales reports & performance', route: '/(tabs)/analytics' },
    ],
  },
  {
    title: 'Account',
    items: [
      { icon: 'storefront', color: '#64748b', label: 'Store Settings', desc: 'Hours, tax rate, branding', route: '/(tabs)/store-settings' },
      { icon: 'people-circle', color: '#64748b', label: 'Team', desc: 'Staff management & roles', route: '/(tabs)/team' },
      { icon: 'settings', color: '#64748b', label: 'Settings', desc: 'Notifications & preferences', route: '/(tabs)/settings' },
    ],
  },
]

export default function MoreDispensaryScreen() {
  const t = useTheme()
  const { logout } = useAuth()
  const haptics = useHaptics()
  const router = useRouter()

  const handlePress = (item: MenuItem) => {
    haptics.light()
    router.push(item.route as any)
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {MENU_SECTIONS.map(section => (
          <View key={section.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: t.textSecondary }]}>{section.title}</Text>
            <View style={[styles.sectionCard, { backgroundColor: t.surface, borderColor: t.border }]}>
              {section.items.map((item, idx) => (
                <TouchableOpacity
                  key={item.label}
                  style={[
                    styles.menuItem,
                    idx < section.items.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
                  ]}
                  onPress={() => handlePress(item)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconBg, { backgroundColor: item.color + '18' }]}>
                    <Ionicons name={item.icon as any} size={18} color={item.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: t.text }]}>{item.label}</Text>
                    <Text style={[styles.desc, { color: t.textMuted }]}>{item.desc}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.logoutBtn, { borderColor: '#ef4444' }]}
          onPress={() => { haptics.medium(); logout() }}
        >
          <Ionicons name="log-out-outline" size={18} color="#ef4444" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 },
  sectionCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  iconBg: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15, fontWeight: '600' },
  desc: { fontSize: 12, marginTop: 1 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10, borderWidth: 1, marginTop: 8,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: '#ef4444' },
})
