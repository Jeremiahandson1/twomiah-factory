import React from 'react'
import { Pressable, View } from 'react-native'
import { DText } from './Text'
import { MIN_TARGET, space } from '../tokens'

/** A heading over a group, with an optional "See all" that is a real 44-point target. */
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TARGET, paddingTop: space[2] }}>
      <DText variant="headline" accessibilityRole="header" style={{ flex: 1 }}>{title}</DText>
      {action ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${action}: ${title}`} onPress={onAction} style={{ minHeight: MIN_TARGET, minWidth: MIN_TARGET, justifyContent: 'center', alignItems: 'flex-end' }}>
          <DText variant="bodyStrong" tone="accentText">{action}</DText>
        </Pressable>
      ) : null}
    </View>
  )
}
