/**
 * PhotoGallery — a job's photo strip with upload.
 *
 * Where a job's photos live on the unified server depends on the vertical (apps/unified/server/modules/crm.ts):
 *   · basic, field service, landscaping and roofing keep them ON THE JOB — GET/POST /api/jobs/:id/photos (the job_photo
 *     table; the web's job page reads the same rows), one file per POST in the form field `photo`. The rows' `url` is
 *     /media/photos/…, served by the site's /media route.
 *   · the contractor has no job photo routes; its photos are documents — GET /api/photos?jobId=…, POST /api/photos/bulk
 *     with `jobId` + `photos`. Their url is /api/photos/:id/file, which needs the session (documents:read).
 * Both are switched on by `photo_capture`. Either way the stored url is RELATIVE to the server, so it is joined to the
 * server address here, and the Authorization header goes with the image request.
 *
 * A photo belongs to a job: /api/photos has no lead or contact filter (it reads ?jobId and ?projectId only), so the old
 * leadId/contactId galleries listed every photo in the company.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Image, Modal, Dimensions, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { OVERLAY_INK } from '../theme/actions'
import { get, upload, getApiUrl, getAccessToken } from '../api/client'
import { useCamera } from '../hooks/useCamera'
import { stampFields, type PhotoStamp } from '../photos/stamp'
import { useToast } from './ToastProvider'
import { useHaptics } from '../hooks/useHaptics'
import { useVertical } from '../vertical/VerticalContext'
import { useOfflineApi } from '../offline/useOfflineApi'
import { useOfflineQueue } from '../offline/OfflineContext'
import { getSaved } from '../offline/readThrough'
import { jobPhotoRequest, pendingJobPhotos } from '../jobflow/jobPhotos'

/** The verticals whose job carries its own photos (CrmSettings.jobs.photos, and roofing's job module). */
const PHOTOS_ON_JOB = ['basic', 'fieldservice', 'landscaping', 'roofing']
export const photosOnJob = (vertical: string) => PHOTOS_ON_JOB.includes(vertical)

export interface JobPhoto {
  id: string
  url?: string | null
  thumbnailUrl?: string | null
  caption?: string | null
}

/** The photos of one job, as either store answers them (a bare array from the shared module, { data } from roofing's). */
export async function loadJobPhotos(vertical: string, jobId: string): Promise<{ ok: boolean; photos: JobPhoto[] }> {
  const res = photosOnJob(vertical)
    ? await getSaved(`/api/jobs/${jobId}/photos`)
    : await getSaved(`/api/photos?jobId=${encodeURIComponent(jobId)}`)
  if (!res.ok) return { ok: false, photos: [] }
  const rows = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []
  return { ok: true, photos: rows }
}

/** One photo onto a job, to the store this vertical keeps them in. */
export function uploadJobPhoto(vertical: string, jobId: string, uri: string, stamp?: PhotoStamp) {
  const fd = new FormData()
  const file = { uri, type: 'image/jpeg', name: `photo_${Date.now()}.jpg` } as any
  if (photosOnJob(vertical)) {
    fd.append('photo', file)
    // Where and when the camera says it was taken, if it said (the inspection report prints them under the photo).
    for (const [k, v] of Object.entries(stampFields(stamp))) fd.append(k, v)
    return upload(`/api/jobs/${jobId}/photos`, fd)
  }
  fd.append('jobId', jobId)
  fd.append('photos', file)
  return upload('/api/photos/bulk', fd)
}

/** An image source for a stored photo: the server address in front of its relative url, and the session beside it. */
export function photoSource(photo: JobPhoto, thumbnail = false) {
  const raw = (thumbnail && photo.thumbnailUrl) || photo.url || ''
  const uri = /^https?:\/\//.test(raw) ? raw : `${getApiUrl()}${raw.startsWith('/') ? '' : '/'}${raw}`
  const token = getAccessToken()
  return token ? { uri, headers: { Authorization: `Bearer ${token}` } } : { uri }
}

interface Props {
  jobId: string
  /** May this person add a photo? (jobs:update on a job's own photos; documents:create on the contractor's.) */
  canAdd?: boolean
}

export function PhotoGallery({ jobId, canAdd = true }: Props) {
  const t = useTheme()
  // The full-screen viewer draws under the status bar (edge-to-edge): the close button clears it.
  const insets = useSafeAreaInsets()
  const toast = useToast()
  const haptics = useHaptics()
  const { vertical, hasFeature } = useVertical()
  const { takePhoto, pickImage } = useCamera()
  const [photos, setPhotos] = useState<JobPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [viewPhoto, setViewPhoto] = useState<JobPhoto | null>(null)
  const enabled = hasFeature('photo_capture')
  const offline = useOfflineApi()
  const { queue } = useOfflineQueue()
  // Pictures taken here that are still on the phone (no signal, or not yet sent).
  const pending = photosOnJob(vertical) ? pendingJobPhotos(queue, jobId) : []

  const loadPhotos = useCallback(async () => {
    if (!enabled) { setLoading(false); return }
    const res = await loadJobPhotos(vertical, jobId)
    setFailed(!res.ok)
    if (res.ok) setPhotos(res.photos)
    setLoading(false)
  }, [vertical, jobId, enabled])

  useEffect(() => { loadPhotos() }, [loadPhotos])
  // When what was waiting is sent, the strip is read again.
  const sentCount = pending.length
  useEffect(() => { if (sentCount === 0) loadPhotos() }, [sentCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // Photo capture is switched off for this business: no strip, rather than one that is refused.
  if (!enabled) return null

  const handleAdd = async (mode: 'camera' | 'gallery') => {
    const result = mode === 'camera' ? await takePhoto() : await pickImage()
    if (!result) return
    // A job that keeps its own photos sends them through the offline queue: with signal at once, without it kept on the phone.
    if (photosOnJob(vertical)) {
      setUploading(true)
      const r = await offline.post(`/api/jobs/${jobId}/photos/saved`, jobPhotoRequest(jobId, [result.uri], 'Job photo').body, { recordKey: jobPhotoRequest(jobId, [], '').recordKey, label: 'Job photo' })
      setUploading(false)
      if (r.queued) { haptics.success(); toast.success('Saved on the phone \u2014 waiting to send') }
      else if (r.ok) { haptics.success(); toast.success('Photo uploaded'); loadPhotos() }
      else { haptics.error(); toast.error(r.error || 'Upload failed') }
      return
    }
    setUploading(true)
    const res = await uploadJobPhoto(vertical, jobId, result.uri, result.stamp)
    if (res.ok) {
      haptics.success()
      toast.success('Photo uploaded')
      loadPhotos()
    } else {
      haptics.error()
      toast.error(res.error || 'Upload failed')
    }
    setUploading(false)
  }

  return (
    <View>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.text }]}>Photos ({photos.length})</Text>
        {canAdd && (
          <View style={styles.addBtns}>
            <TouchableOpacity style={[styles.addBtn, { backgroundColor: t.primaryLight }]} onPress={() => handleAdd('camera')} disabled={uploading}>
              <Ionicons name="camera" size={16} color={t.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.addBtn, { backgroundColor: t.primaryLight }]} onPress={() => handleAdd('gallery')} disabled={uploading}>
              <Ionicons name="images" size={16} color={t.primary} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginVertical: 20 }} color={t.primary} />
      ) : failed ? (
        <Text style={{ color: t.textMuted, fontSize: 12 }}>Photos could not be loaded. Pull to refresh.</Text>
      ) : photos.length === 0 && !uploading && pending.length === 0 ? (
        canAdd ? (
          <TouchableOpacity style={[styles.emptyBox, { borderColor: t.border }]} onPress={() => handleAdd('camera')}>
            <Ionicons name="camera-outline" size={24} color={t.textMuted} />
            <Text style={{ color: t.textMuted, fontSize: 12 }}>Tap to add first photo</Text>
          </TouchableOpacity>
        ) : (
          <Text style={{ color: t.textMuted, fontSize: 12 }}>No photos yet</Text>
        )
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {uploading && (
            <View style={[styles.thumb, styles.uploadingThumb, { borderColor: t.primary }]}>
              <ActivityIndicator color={t.primary} />
            </View>
          )}
          {pending.map(p => (
            <View key={`${p.itemId}:${p.uri}`} accessibilityLabel={p.state === 'failed' ? "Couldn't send \u2014 tap to fix in Waiting to send" : 'Waiting to send'}>
              <Image source={{ uri: p.uri }} style={[styles.thumb, { opacity: 0.6 }]} />
              <View style={{ position: 'absolute', right: 4, top: 4 }}><Ionicons name={p.state === 'failed' ? 'alert-circle' : 'time'} size={18} color={p.state === 'failed' ? t.error : t.warning} /></View>
            </View>
          ))}
          {photos.map(photo => (
            <TouchableOpacity key={photo.id} onPress={() => setViewPhoto(photo)}>
              <Image source={photoSource(photo, true)} style={styles.thumb} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Full-screen viewer */}
      <Modal visible={!!viewPhoto} transparent animationType="fade" onRequestClose={() => setViewPhoto(null)}>
        <View style={styles.modal}>
          <TouchableOpacity style={[styles.modalClose, { top: insets.top + 12 }]} onPress={() => setViewPhoto(null)}>
            <Ionicons name="close" size={28} color={OVERLAY_INK} />
          </TouchableOpacity>
          {viewPhoto && (
            <Image source={photoSource(viewPhoto)} style={styles.fullImage} resizeMode="contain" />
          )}
          {viewPhoto?.caption ? (
            <Text style={styles.caption}>{viewPhoto.caption}</Text>
          ) : null}
        </View>
      </Modal>
    </View>
  )
}

const { width: SCREEN_WIDTH } = Dimensions.get('window')

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 15, fontWeight: '700' },
  addBtns: { flexDirection: 'row', gap: 8 },
  addBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  strip: { gap: 8, paddingBottom: 4 },
  thumb: { width: 80, height: 80, borderRadius: 8 },
  uploadingThumb: {
    borderWidth: 2, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent',
  },
  emptyBox: {
    borderWidth: 2, borderStyle: 'dashed', borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 20, marginBottom: 4,
  },
  modal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  modalClose: { position: 'absolute', right: 20, zIndex: 10, padding: 8 },
  fullImage: { width: SCREEN_WIDTH, height: SCREEN_WIDTH },
  caption: { color: OVERLAY_INK, fontSize: 14, marginTop: 12, textAlign: 'center' },
})
