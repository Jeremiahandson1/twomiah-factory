import React from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { useDesign } from '../DesignContext'
import { Icon } from './Icon'
import { MIN_TARGET, MAX_FONT_SCALE, radius, space, type as t } from '../tokens'

/** Search: a 48-point field with a magnifier, a clear button that is a 44-point target, and a label for screen readers. */
/** `onScan`: a barcode button at the end that opens the camera (src/scan/BarcodeScanner.tsx). */
export function SearchField({ value, onChangeText, placeholder = 'Search', label, onScan }: { value: string; onChangeText: (s: string) => void; placeholder?: string; label?: string; onScan?: () => void }) {
  const { c } = useDesign()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.borderStrong, backgroundColor: c.surface, paddingLeft: space[3] }}>
      <Icon name="search" size={20} tone="subtle" />
      <TextInput accessibilityLabel={label || placeholder} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={c.textSubtle} maxFontSizeMultiplier={MAX_FONT_SCALE}
        returnKeyType="search" autoCorrect={false} style={{ flex: 1, color: c.text, fontSize: t.body.size, minHeight: 46, paddingHorizontal: space[2] }} />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText('')} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close-circle" size={20} tone="subtle" />
        </Pressable>
      ) : null}
      {onScan ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Scan a barcode" onPress={onScan} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="barcode-outline" size={22} tone="text" />
        </Pressable>
      ) : null}
    </View>
  )
}
