/**
 * Avatar circle with initial letter fallback.
 */

import React from 'react'
import { View, Text, Image, StyleSheet } from 'react-native'
import { useTheme } from '../theme/ThemeContext'

interface AvatarCircleProps {
  name?: string
  avatar?: string
  size?: number
  color?: string
}

export function AvatarCircle({ name, avatar, size = 40, color }: AvatarCircleProps) {
  const t = useTheme()
  const bgColor = color || t.primaryLight
  const textColor = color ? '#fff' : t.primary
  const initial = (name || '?')[0].toUpperCase()

  if (avatar) {
    return (
      <Image
        source={{ uri: avatar }}
        style={[styles.img, { width: size, height: size, borderRadius: size / 2 }]}
      />
    )
  }

  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bgColor }]}>
      <Text style={[styles.initial, { color: textColor, fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontWeight: '700' },
  img: { backgroundColor: '#e2e8f0' },
})
