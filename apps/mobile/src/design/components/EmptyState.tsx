import React from 'react'
import { View } from 'react-native'
import { DText } from './Text'
import { Icon } from './Icon'
import { Button } from './Button'
import { useDesign } from '../DesignContext'
import { radius, space } from '../tokens'

/** Nothing here yet — says what the list is for and what to do about it. */
export function EmptyState({ icon, title, body, action, onAction }: { icon: string; title: string; body?: string; action?: string; onAction?: () => void }) {
  const { c } = useDesign()
  return (
    <View style={{ alignItems: 'center', padding: space[8], gap: space[3] }}>
      <View style={{ width: 72, height: 72, borderRadius: radius.xl, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={32} tone="accent" /></View>
      <DText variant="headline" style={{ textAlign: 'center' }}>{title}</DText>
      {body ? <DText variant="callout" tone="textSecondary" style={{ textAlign: 'center' }}>{body}</DText> : null}
      {action ? <Button label={action} onPress={onAction} variant="tonal" /> : null}
    </View>
  )
}
