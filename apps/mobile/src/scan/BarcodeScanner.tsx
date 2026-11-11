/**
 * The camera, reading one barcode (parity tier 2 #10, feature barcode_scanning, not ready): opened from a list's search box
 * (TradeList, a spec's `search.scan`), it hands the first code it reads back and closes. The camera module and its permission
 * text are already in the app (app.config.ts, expo-camera); without permission it says so and offers to ask again.
 */
import React, { useEffect, useRef } from 'react'
import { Modal, View, Text, Linking } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { Button, useDesign, space } from '../design'
import { BARCODE_TYPES, cleanCode } from './codes'
import { OVERLAY_INK } from '../theme/actions'

export function BarcodeScanner({ visible, onScanned, onClose }: { visible: boolean; onScanned: (code: string) => void; onClose: () => void }) {
  const { c } = useDesign()
  const [perm, ask] = useCameraPermissions()
  // One code per opening: the camera keeps reporting the same code many times a second.
  const done = useRef(false)
  useEffect(() => {
    if (!visible) return
    done.current = false
    if (perm && !perm.granted && perm.canAskAgain) ask()
  }, [visible, perm?.granted]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {perm?.granted ? (
          <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
            onBarcodeScanned={(r) => {
              if (done.current) return
              const code = cleanCode(r?.data)
              if (!code) return
              done.current = true
              onScanned(code)
            }} />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', padding: space[5], gap: space[3], backgroundColor: c.background }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '600' }}>{perm ? 'The camera is turned off for this app' : 'Opening the camera…'}</Text>
            {perm ? <Text style={{ color: c.textSubtle, fontSize: 16 }}>To scan a barcode, allow the camera{perm.canAskAgain ? '.' : ' in your phone’s Settings.'}</Text> : null}
            {perm ? <Button label={perm.canAskAgain ? 'Allow the camera' : 'Open Settings'} onPress={() => (perm.canAskAgain ? ask() : Linking.openSettings())} fullWidth /> : null}
          </View>
        )}
        <View style={{ position: 'absolute', left: space[4], right: space[4], bottom: space[6] }}>
          {perm?.granted ? <Text style={{ color: OVERLAY_INK, fontSize: 16, textAlign: 'center', marginBottom: space[3] }}>Point the camera at the barcode</Text> : null}
          <Button label="Close" variant="secondary" onPress={onClose} fullWidth />
        </View>
      </View>
    </Modal>
  )
}
