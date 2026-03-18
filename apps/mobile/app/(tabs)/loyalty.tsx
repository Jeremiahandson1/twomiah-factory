/**
 * Loyalty — dispensary loyalty program management and point lookup.
 */

import React, { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get } from '../../src/api/client'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { useHaptics } from '../../src/hooks/useHaptics'
import { useToast } from '../../src/components/ToastProvider'

const TIER_CONFIG = [
  { name: 'Bronze', min: 0, color: '#d97706', icon: 'star-outline' },
  { name: 'Silver', min: 500, color: '#64748b', icon: 'star-half' },
  { name: 'Gold', min: 1500, color: '#f59e0b', icon: 'star' },
  { name: 'Platinum', min: 5000, color: '#6366f1', icon: 'diamond' },
]

export default function LoyaltyScreen() {
  const t = useTheme()
  const haptics = useHaptics()
  const toast = useToast()
  const [phone, setPhone] = useState('')
  const [member, setMember] = useState<any>(null)
  const [rewards, setRewards] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  const lookupMember = async () => {
    if (!phone.trim()) { toast.warning('Enter a phone number'); return }
    haptics.light()
    setSearching(true)
    const res = await get(`/api/loyalty/check?phone=${encodeURIComponent(phone.trim())}`)
    if (res.ok && res.data) {
      setMember(res.data)
      // Load rewards catalog
      const rewardsRes = await get('/api/loyalty/rewards')
      if (rewardsRes.ok) setRewards(rewardsRes.data.data || rewardsRes.data || [])
      haptics.success()
    } else {
      setMember(null)
      toast.info('No loyalty member found for this number')
    }
    setSearching(false)
  }

  const tier = member ? TIER_CONFIG.find(t => member.lifetimePoints >= t.min) || TIER_CONFIG[0] : null

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Lookup */}
        <Text style={[styles.sectionTitle, { color: t.text }]}>Customer Loyalty Lookup</Text>
        <View style={[styles.lookupRow, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Ionicons name="call" size={18} color={t.textMuted} />
          <TextInput
            style={[styles.phoneInput, { color: t.text }]}
            value={phone}
            onChangeText={setPhone}
            placeholder="Enter phone number"
            placeholderTextColor={t.textMuted}
            keyboardType="phone-pad"
            returnKeyType="search"
            onSubmitEditing={lookupMember}
          />
          <TouchableOpacity
            style={[styles.lookupBtn, { backgroundColor: t.primary }]}
            onPress={lookupMember}
            disabled={searching}
          >
            <Ionicons name="search" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Member card */}
        {member && tier && (
          <AnimatedCard index={0}>
            <View style={[styles.memberCard, { backgroundColor: t.surface, borderColor: t.border }]}>
              <View style={[styles.tierHeader, { backgroundColor: tier.color + '15' }]}>
                <Ionicons name={tier.icon as any} size={24} color={tier.color} />
                <View>
                  <Text style={[styles.memberName, { color: t.text }]}>{member.name || member.contact?.name}</Text>
                  <Text style={[styles.tierName, { color: tier.color }]}>{tier.name} Member</Text>
                </View>
              </View>
              <View style={styles.pointsGrid}>
                <View style={styles.pointItem}>
                  <Text style={[styles.pointValue, { color: t.primary }]}>{member.pointsBalance}</Text>
                  <Text style={[styles.pointLabel, { color: t.textMuted }]}>Available Points</Text>
                </View>
                <View style={styles.pointItem}>
                  <Text style={[styles.pointValue, { color: t.text }]}>{member.lifetimePoints}</Text>
                  <Text style={[styles.pointLabel, { color: t.textMuted }]}>Lifetime Points</Text>
                </View>
                <View style={styles.pointItem}>
                  <Text style={[styles.pointValue, { color: '#22c55e' }]}>
                    ${((member.totalSpent || 0) / 100).toFixed(0)}
                  </Text>
                  <Text style={[styles.pointLabel, { color: t.textMuted }]}>Total Spent</Text>
                </View>
              </View>
              {member.referralCode && (
                <View style={[styles.referralRow, { borderTopColor: t.border }]}>
                  <Text style={[styles.referralLabel, { color: t.textMuted }]}>Referral Code</Text>
                  <Text style={[styles.referralCode, { color: t.primary }]}>{member.referralCode}</Text>
                </View>
              )}
            </View>
          </AnimatedCard>
        )}

        {/* Available rewards */}
        {rewards.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: t.text, marginTop: 20 }]}>Available Rewards</Text>
            {rewards.map((reward, idx) => (
              <AnimatedCard key={reward.id} index={idx + 1}>
                <View style={[styles.rewardCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                  <View style={[styles.rewardIcon, { backgroundColor: '#f59e0b18' }]}>
                    <Ionicons name="gift" size={20} color="#f59e0b" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rewardName, { color: t.text }]}>{reward.name}</Text>
                    <Text style={[styles.rewardDesc, { color: t.textMuted }]}>{reward.description}</Text>
                  </View>
                  <View style={[styles.pointsCost, { backgroundColor: t.primaryLight }]}>
                    <Text style={[styles.pointsCostText, { color: t.primary }]}>{reward.pointsCost} pts</Text>
                  </View>
                </View>
              </AnimatedCard>
            ))}
          </>
        )}

        {/* Tier explainer */}
        <Text style={[styles.sectionTitle, { color: t.text, marginTop: 20 }]}>Loyalty Tiers</Text>
        <View style={[styles.tierGrid, { backgroundColor: t.surface, borderColor: t.border }]}>
          {TIER_CONFIG.map(t2 => (
            <View key={t2.name} style={styles.tierRow}>
              <Ionicons name={t2.icon as any} size={18} color={t2.color} />
              <Text style={[styles.tierRowName, { color: t2.color }]}>{t2.name}</Text>
              <Text style={{ color: '#64748b', fontSize: 12 }}>{t2.min}+ pts</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  lookupRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, paddingLeft: 12, overflow: 'hidden',
    marginBottom: 16,
  },
  phoneInput: { flex: 1, paddingVertical: 14, fontSize: 15 },
  lookupBtn: { padding: 14, borderRadius: 0 },
  memberCard: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginBottom: 8 },
  tierHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  memberName: { fontSize: 17, fontWeight: '700' },
  tierName: { fontSize: 13, fontWeight: '600', marginTop: 1 },
  pointsGrid: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12 },
  pointItem: { flex: 1, alignItems: 'center' },
  pointValue: { fontSize: 20, fontWeight: '700' },
  pointLabel: { fontSize: 11, marginTop: 2 },
  referralRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  referralLabel: { fontSize: 12 },
  referralCode: { fontSize: 14, fontWeight: '700' },
  rewardCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8,
  },
  rewardIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rewardName: { fontSize: 14, fontWeight: '600' },
  rewardDesc: { fontSize: 12, marginTop: 2 },
  pointsCost: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  pointsCostText: { fontSize: 12, fontWeight: '700' },
  tierGrid: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierRowName: { flex: 1, fontSize: 14, fontWeight: '600' },
})
