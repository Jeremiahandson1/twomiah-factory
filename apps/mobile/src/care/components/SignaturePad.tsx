/**
 * Signature pad — finger-drawn, no native drawing module needed. Strokes are drawn as short line
 * segments while signing and exported as an SVG data URI (rules.ts signatureDataUri), which
 * POST /api/documents/:id/sign accepts as `signatureImageBase64`. The pad is always white with dark
 * ink — a signature looks the same in light and dark mode and on the office's printout.
 */
import React, { useMemo, useRef, useState } from 'react'
import { View, PanResponder, StyleSheet, Text, type LayoutChangeEvent } from 'react-native'
import { useTheme } from '../../theme/ThemeContext'
import { hasInk, signatureDataUri, type Stroke } from '../rules'
import { Button } from '../ui'

const INK = '#111827'

function Segment({ a, b }: { a: { x: number; y: number }; b: { x: number; y: number } }) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.5) return <View style={[styles.dot, { left: a.x - 1.5, top: a.y - 1.5 }]} />
  const angle = Math.atan2(dy, dx)
  return (
    <View
      style={{
        position: 'absolute', left: (a.x + b.x) / 2 - len / 2, top: (a.y + b.y) / 2 - 1.5,
        width: len, height: 3, borderRadius: 1.5, backgroundColor: INK, transform: [{ rotate: `${angle}rad` }],
      }}
    />
  )
}

/** onDrawing: true while a finger is down — the screen should stop scrolling so the stroke isn't stolen. */
export function SignaturePad({ onSubmit, submitting, onDrawing }: { onSubmit: (dataUri: string) => void; submitting?: boolean; onDrawing?: (drawing: boolean) => void }) {
  const drawingCb = useRef(onDrawing)
  drawingCb.current = onDrawing
  const t = useTheme()
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const size = useRef({ w: 300, h: 180 })
  const current = useRef<Stroke | null>(null)

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent
      current.current = [{ x, y }]
      drawingCb.current?.(true)
      setStrokes((s) => [...s, current.current!])
    },
    onPanResponderMove: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent
      const s = current.current
      if (!s) return
      const last = s[s.length - 1]
      if (Math.abs(last.x - x) + Math.abs(last.y - y) < 2) return
      const next = [...s, { x: Math.max(0, Math.min(size.current.w, x)), y: Math.max(0, Math.min(size.current.h, y)) }]
      current.current = next
      setStrokes((all) => [...all.slice(0, -1), next])
    },
    onPanResponderRelease: () => { current.current = null; drawingCb.current?.(false) },
    onPanResponderTerminate: () => { current.current = null; drawingCb.current?.(false) },
  }), [])

  const onLayout = (e: LayoutChangeEvent) => { size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height } }
  const inked = hasInk(strokes)

  return (
    <View>
      <View style={[styles.pad, { borderColor: t.border }]} onLayout={onLayout} {...responder.panHandlers}>
        {/* pointerEvents none: a touch must always land on the pad, so locationX/Y stay pad-relative */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {strokes.map((s, i) => s.length === 1
            ? <Segment key={`${i}-0`} a={s[0]} b={s[0]} />
            : s.slice(1).map((p, j) => <Segment key={`${i}-${j}`} a={s[j]} b={p} />))}
          {!strokes.length && <Text style={styles.placeholder}>Sign here with your finger</Text>}
        </View>
        <View style={styles.line} pointerEvents="none" />
      </View>
      <View style={styles.actions}>
        <Button small variant="secondary" label="Clear" icon="refresh" onPress={() => setStrokes([])} disabled={!strokes.length || submitting} style={{ flex: 1 }} />
        <Button small label="Sign" icon="create-outline" disabled={!inked} loading={submitting} style={{ flex: 2 }}
          onPress={() => onSubmit(signatureDataUri(strokes, size.current.w, size.current.h))} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pad: { height: 190, borderWidth: 1, borderRadius: 12, backgroundColor: '#ffffff', overflow: 'hidden' },
  dot: { position: 'absolute', width: 3, height: 3, borderRadius: 1.5, backgroundColor: INK },
  placeholder: { position: 'absolute', top: 70, left: 0, right: 0, textAlign: 'center', color: '#475569', fontSize: 15 },
  line: { position: 'absolute', left: 20, right: 20, bottom: 40, height: 1, backgroundColor: '#94a3b8' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
})
