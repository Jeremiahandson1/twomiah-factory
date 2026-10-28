/** The alerts bell in the header of every tab screen (it used to take a bottom-bar slot; the last slot is More). */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useVertical } from '../vertical/VerticalContext'
import { useCareOptional } from '../care/CareContext'
import { Pressable } from 'react-native'
import { Icon, DText, MIN_TARGET, useDesign } from '../design'
import { inkOn } from '../theme/contrast'

export function HeaderBell() {
  const router = useRouter()
  const { c } = useDesign()
  const { vertical } = useVertical()
  const care = useCareOptional()
  const n = care?.enabled ? care.unreadNotifications : 0
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={n > 0 ? `Alerts, ${n} unread` : 'Alerts'}
      onPress={() => router.push((vertical === 'homecare' ? '/(care)/notifications' : '/(tabs)/notifications') as any)}
      style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center', marginRight: 4 }}>
      <Icon name="notifications-outline" size={24} tone="text" />
      {n > 0 ? (
        <View style={{ position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.tones.danger.fill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <DText variant="caption" style={{ color: inkOn(c.tones.danger.fill), fontSize: 11, lineHeight: 14 }}>{n > 99 ? '99+' : n}</DText>
        </View>
      ) : null}
    </Pressable>
  )
}
