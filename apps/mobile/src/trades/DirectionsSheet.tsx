/**
 * Directions in the crew's own maps app (landscaping parity row 11): the first time, a sheet offers the apps this phone has a choice
 * of — Google Maps, Apple Maps (iPhone), Waze — with "Remember my choice"; after that a tap goes straight to the remembered app, and
 * "Change maps app" on the visit asks again. The choice is this phone's (AsyncStorage), never sent anywhere. Rules: ./directions.ts.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Linking, Platform, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BottomSheet, Button, Chip, DText, space } from '../design'
import { appsFor, CHOICE_KEY, directionsUrl, readChoice, type MapsApp } from './directions'

/** The remembered maps app (null: ask), and the way to change it. */
export function useMapsChoice() {
  const [choice, setChoice] = useState<MapsApp | null>(null)
  useEffect(() => { AsyncStorage.getItem(CHOICE_KEY).then((v) => setChoice(readChoice(v, Platform.OS))).catch(() => {}) }, [])
  const remember = useCallback(async (app: MapsApp | null) => {
    setChoice(app)
    try { if (app) await AsyncStorage.setItem(CHOICE_KEY, app); else await AsyncStorage.removeItem(CHOICE_KEY) } catch { /* the choice is asked again next time */ }
  }, [])
  return { choice, remember }
}

export function DirectionsSheet({ address, onClose, onChosen }: { address: string | null; onClose: () => void; onChosen: (app: MapsApp, keep: boolean) => void }) {
  const apps = appsFor(Platform.OS)
  const [app, setApp] = useState<MapsApp>(apps[0].id)
  const [keep, setKeep] = useState(true)
  return (
    <BottomSheet visible={!!address} title="Open directions in" onClose={onClose}>
      <View style={{ gap: space[3] }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {apps.map((a) => <Chip key={a.id} label={a.label} selected={app === a.id} onPress={() => setApp(a.id)} />)}
        </View>
        <Chip label="Remember my choice" selected={keep} onPress={() => setKeep((k) => !k)} />
        <DText variant="callout" tone="textSecondary">If the app is not on this phone, the directions open in the browser.</DText>
        <Button label="Get directions" icon="navigate" fullWidth onPress={() => { if (!address) return; onChosen(app, keep); Linking.openURL(directionsUrl(app, address)); onClose() }} />
      </View>
    </BottomSheet>
  )
}
