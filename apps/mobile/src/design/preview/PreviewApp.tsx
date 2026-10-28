import React from 'react'
import { Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { DesignProvider, DText, ListRow, Group, SectionHeader } from '..'
import { SCREENS } from './registry'
import { PREVIEW_SENTINEL } from './sample'

/**
 * DEV-ONLY. /design-preview            → the list of mock-ups
 *           /design-preview?s=<id>&mode=dark&c=%23b91c1c  → one mock-up, in that scheme and business colour (web: read from the address)
 * Never in a store build: app/design-preview.tsx only loads this under __DEV__ (tests/mobile/design-preview-dev-only.test.ts).
 */
export function PreviewApp() {
  const q = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
  const id = q.get('s')
  const dark = q.get('mode') === 'dark'
  const entry = SCREENS.find((s) => s.id === id)
  if (entry) return <DesignProvider primary={q.get('c') || entry.brand} dark={dark}><View style={{ flex: 1 }} testID={`preview-${entry.id}`}>{entry.render()}</View></DesignProvider>
  return (
    <DesignProvider primary="#1e40af" dark={dark}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 48, gap: 12 }}>
        <DText variant="display">Design preview</DText>
        <DText variant="callout" tone="textSecondary">Development only. Sample data. {PREVIEW_SENTINEL}</DText>
        {[...new Set(SCREENS.map((s) => s.group))].map((g) => (
          <View key={g}><SectionHeader title={g} /><Group>{SCREENS.filter((s) => s.group === g).map((s, i, a) => (
            <ListRow key={s.id} title={s.title} subtitle={s.id} onPress={() => { if (Platform.OS === 'web') window.location.search = `?s=${s.id}` }} divider={i < a.length - 1} />))}</Group></View>
        ))}
      </ScrollView>
    </DesignProvider>
  )
}
