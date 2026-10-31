/**
 * Draw on a job photo, on the phone (docs/parity/roof-gbb-proposals.md #4, roof-inspection-report.md #13): arrows, circles and
 * text over the picture, saved through the offline queue (PUT /api/photo-markup/:photoId, offline/README.md) so a roof with no
 * signal still takes the marks. The server lays them on the photo and keeps a marked copy beside the original.
 *
 * The marks are shapes in fractions of the picture (./markup.ts), drawn here from plain Views (no drawing library in the app).
 * Needs the photo to be on the server already (the gallery uploads a photo as it is taken; a photo not yet sent has no id).
 * Shown only with the `photo_markup` feature and a person who may change the job's photos (jobs:update).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Image, Modal, PanResponder, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { OVERLAY_INK } from '../theme/actions'
import { useToast } from '../components/ToastProvider'
import { useOfflineApi } from '../offline/useOfflineApi'
import {
  COLOR_LABELS, MARKUP_COLORS, MAX_SHAPES, MAX_TEXT, SIZE_LABELS, markupSave, parts, primitive, shapeFromDrag,
  type MarkupColor, type MarkupShape, type Part, type TextSize,
} from './markup'

type Tool = 'arrow' | 'circle' | 'text'
type Point = { x: number; y: number }
const TOOLS: Array<{ id: Tool; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = [
  { id: 'arrow', label: 'Arrow', icon: 'arrow-up-outline' }, { id: 'circle', label: 'Circle', icon: 'ellipse-outline' }, { id: 'text', label: 'Text', icon: 'text-outline' },
]
const SIZES: TextSize[] = ['small', 'medium', 'large']

/** One shape as Views, at w x h (the same rules as the server's marked copy: ./markup.ts). */
export function MarkShape({ shape, w, h }: { shape: MarkupShape; w: number; h: number }) {
  const list: Part[] = useMemo(() => parts(primitive(shape, w, h)), [shape, w, h])
  return (
    <>
      {list.map((p, i) => {
        if (p.kind === 'bar') {
          const b = p.bar
          return <View key={i} pointerEvents="none" style={{ position: 'absolute', left: b.left, top: b.top, width: b.width, height: b.height, borderRadius: b.round, backgroundColor: p.color, transform: [{ rotate: `${b.angle}rad` }] }} />
        }
        if (p.kind === 'triangle') {
          const t = p.triangle
          return <View key={i} pointerEvents="none" style={{ position: 'absolute', left: t.left, top: t.top, width: 0, height: 0, borderLeftWidth: t.size / 2, borderRightWidth: t.size / 2, borderBottomWidth: t.size, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: p.color, transform: [{ rotate: `${t.angle}rad` }] }} />
        }
        return <Text key={i} pointerEvents="none" style={{ position: 'absolute', left: p.x, top: p.y, fontSize: p.size, fontWeight: '700', color: p.color, textShadowColor: p.halo, textShadowRadius: p.size * 0.12, textShadowOffset: { width: 0, height: 0 } }}>{p.text}</Text>
      })}
    </>
  )
}

export function PhotoMarkup({ visible, photo, source, shapes: initial, jobNumber, onClose, onSaved }: {
  visible: boolean
  photo: { id: string; caption?: string | null }
  /** The picture to draw on (the original, with the session that fetches it). */
  source: { uri: string; headers?: Record<string, string> }
  shapes: MarkupShape[]
  jobNumber?: string | null
  onClose: () => void
  /** `queued` when it was kept on the phone to send later; the marked copy is not there yet. */
  onSaved: (queued: boolean) => void
}) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const toast = useToast()
  const { put } = useOfflineApi()
  const [shapes, setShapes] = useState<MarkupShape[]>(initial)
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState<MarkupColor>('red')
  const [size, setSize] = useState<TextSize>('medium')
  const [ratio, setRatio] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ a: Point; b: Point } | null>(null)
  const [pending, setPending] = useState<Point | null>(null)
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef({ w: 1, h: 1 })
  const live = useRef({ tool, color, shapes })
  live.current = { tool, color, shapes }

  useEffect(() => { if (visible) { setShapes(initial); setPending(null); setDrag(null) } }, [visible, photo.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible) return
    const ok = (w: number, h: number) => setRatio(w > 0 ? h / w : 0.75)
    if (source.headers) Image.getSizeWithHeaders(source.uri, source.headers, ok, () => setRatio(0.75))
    else Image.getSize(source.uri, ok, () => setRatio(0.75))
  }, [visible, source.uri]) // eslint-disable-line react-hooks/exhaustive-deps

  const { width: sw, height: sh } = Dimensions.get('window')
  const maxW = sw - 24, maxH = sh - insets.top - insets.bottom - 280
  const r = ratio ?? 0.75
  const w = Math.min(maxW, maxH / r), h = w * r
  box.current = { w, h }

  const to = (x: number, y: number): Point => ({ x: Math.min(1, Math.max(0, x / box.current.w)), y: Math.min(1, Math.max(0, y / box.current.h)) })
  const start = useRef<Point>({ x: 0, y: 0 })
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      start.current = to(e.nativeEvent.locationX, e.nativeEvent.locationY)
      if (live.current.tool === 'text') { setPending(start.current); setWords(''); return }
      if (live.current.shapes.length >= MAX_SHAPES) { toast.error(`A photo holds ${MAX_SHAPES} marks at most`); return }
      setDrag({ a: start.current, b: start.current })
    },
    onPanResponderMove: (_e, g) => {
      if (live.current.tool === 'text') return
      setDrag((d) => (d ? { a: d.a, b: to(start.current.x * box.current.w + g.dx, start.current.y * box.current.h + g.dy) } : d))
    },
    onPanResponderRelease: (_e, g) => {
      if (live.current.tool === 'text') return
      const end = to(start.current.x * box.current.w + g.dx, start.current.y * box.current.h + g.dy)
      setDrag(null)
      if (live.current.shapes.length >= MAX_SHAPES) return
      const s = shapeFromDrag(live.current.tool as 'arrow' | 'circle', start.current, end, live.current.color)
      if (s) setShapes((prev) => [...prev, s])
    },
    onPanResponderTerminate: () => setDrag(null),
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  const place = () => {
    const text = words.trim()
    if (pending && text) setShapes((prev) => (prev.length >= MAX_SHAPES ? prev : [...prev, { kind: 'text', x: Math.min(pending.x, 0.95), y: Math.min(pending.y, 0.95), text: text.slice(0, MAX_TEXT), color, size }]))
    setPending(null); setWords('')
  }
  const draft = drag && tool !== 'text' ? shapeFromDrag(tool, drag.a, drag.b, color) : null

  const save = async () => {
    setBusy(true)
    const s = markupSave(photo.id, shapes, jobNumber)
    const res = await put(s.path, s.body, s.opts)
    setBusy(false)
    if (res.queued) { toast.success('Saved on the phone. The marked copy is made when there is signal.'); onSaved(true); return }
    if (!res.ok) { toast.error(res.error || 'Could not save the marks'); return }
    toast.success(shapes.length ? 'Marked copy saved beside the original' : 'Marks removed')
    onSaved(false)
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: '#000', paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.top}>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close without saving" style={styles.iconBtn}><Ionicons name="close" size={26} color={OVERLAY_INK} /></TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{photo.caption || 'Draw on photo'}</Text>
          <TouchableOpacity onPress={save} disabled={busy || (shapes.length === 0 && initial.length === 0)} accessibilityRole="button" style={[styles.save, { backgroundColor: t.primary, opacity: busy || (shapes.length === 0 && initial.length === 0) ? 0.5 : 1 }]}>
            {busy ? <ActivityIndicator color={OVERLAY_INK} /> : <Text style={[styles.saveText, { color: t.onPrimary }]}>{shapes.length === 0 && initial.length > 0 ? 'Remove marks' : 'Save'}</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.stage}>
          {ratio === null ? <ActivityIndicator color={OVERLAY_INK} /> : (
            <View style={{ width: w, height: h }} {...pan.panHandlers} accessibilityLabel="Photo to draw on">
              <Image source={source} style={{ width: w, height: h }} resizeMode="stretch" />
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                {shapes.map((s, i) => <MarkShape key={i} shape={s} w={w} h={h} />)}
                {draft && <MarkShape shape={draft} w={w} h={h} />}
              </View>
            </View>
          )}
        </View>

        {pending && (
          <View style={styles.textRow}>
            <TextInput autoFocus value={words} onChangeText={setWords} maxLength={MAX_TEXT} placeholder="Words to put on the photo" placeholderTextColor="#9ca3af" style={styles.input} onSubmitEditing={place} returnKeyType="done" accessibilityLabel="Text to place" />
            <TouchableOpacity onPress={place} style={[styles.save, { backgroundColor: t.primary }]} accessibilityRole="button"><Text style={[styles.saveText, { color: t.onPrimary }]}>Add</Text></TouchableOpacity>
          </View>
        )}

        <View style={styles.tools}>
          {TOOLS.map((x) => (
            <TouchableOpacity key={x.id} onPress={() => setTool(x.id)} accessibilityRole="button" accessibilityState={{ selected: tool === x.id }} accessibilityLabel={x.label}
              style={[styles.tool, tool === x.id && { backgroundColor: t.primary }]}>
              <Ionicons name={x.icon} size={20} color={OVERLAY_INK} /><Text style={styles.toolText}>{x.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => setShapes((p) => p.slice(0, -1))} disabled={shapes.length === 0} accessibilityRole="button" accessibilityLabel="Undo" style={[styles.tool, { opacity: shapes.length ? 1 : 0.4 }]}>
            <Ionicons name="arrow-undo" size={20} color={OVERLAY_INK} /><Text style={styles.toolText}>Undo</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.tools}>
          {(Object.keys(MARKUP_COLORS) as MarkupColor[]).map((c) => (
            <TouchableOpacity key={c} onPress={() => setColor(c)} accessibilityRole="button" accessibilityLabel={COLOR_LABELS[c]} accessibilityState={{ selected: color === c }}
              style={[styles.swatch, { backgroundColor: MARKUP_COLORS[c], borderColor: color === c ? OVERLAY_INK : '#6b7280', borderWidth: color === c ? 3 : 1 }]} />
          ))}
          {tool === 'text' && SIZES.map((s) => (
            <TouchableOpacity key={s} onPress={() => setSize(s)} accessibilityRole="button" accessibilityLabel={`${SIZE_LABELS[s]} text`} accessibilityState={{ selected: size === s }} style={[styles.tool, size === s && { backgroundColor: t.primary }]}>
              <Text style={styles.toolText}>{SIZE_LABELS[s]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>
          {tool === 'text' ? 'Tap where the words should start.' : tool === 'arrow' ? 'Drag from the tail of the arrow to its point.' : 'Drag across the area to circle.'} {shapes.length} of {MAX_SHAPES} marks. The original is not changed.
        </Text>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  iconBtn: { padding: 6 },
  title: { flex: 1, color: OVERLAY_INK, fontSize: 15, fontWeight: '600' },
  save: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, minWidth: 64, alignItems: 'center' },
  saveText: { color: OVERLAY_INK, fontWeight: '700', fontSize: 14 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  textRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  input: { flex: 1, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#111827' },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginVertical: 4 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: '#374151', minHeight: 44 },
  toolText: { color: OVERLAY_INK, fontSize: 13, fontWeight: '600' },
  swatch: { width: 40, height: 40, borderRadius: 20 },
  hint: { color: '#9ca3af', fontSize: 12, textAlign: 'center', marginTop: 6 },
})
