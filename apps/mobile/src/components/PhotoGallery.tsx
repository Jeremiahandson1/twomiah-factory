/**
 * PhotoGallery — reusable horizontal photo strip with upload.
 * Fetches photos for an entity, allows adding via camera/gallery.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Image, Modal, Dimensions, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../theme/ThemeContext'
import { get, uploadPhotos, getApiUrl } from '../api/client'
import { useCamera } from '../hooks/useCamera'
import { useToast } from './ToastProvider'
import { useHaptics } from '../hooks/useHaptics'

interface Props {
  entityType: 'jobId' | 'leadId' | 'contactId'
  entityId: string
}

interface Photo {
  id: string
  url?: string
  thumbnailUrl?: string
  caption?: string
}

export function PhotoGallery({ entityType, entityId }: Props) {
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const { takePhoto, pickImage } = useCamera()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [viewPhoto, setViewPhoto] = useState<Photo | null>(null)

  const loadPhotos = useCallback(async () => {
    const res = await get(`/api/photos?${entityType}=${entityId}`)
    if (res.ok) setPhotos(res.data.data || res.data || [])
    setLoading(false)
  }, [entityType, entityId])

  useEffect(() => { loadPhotos() }, [loadPhotos])

  const handleAdd = async (mode: 'camera' | 'gallery') => {
    const result = mode === 'camera' ? await takePhoto() : await pickImage()
    if (!result) return
    setUploading(true)
    const res = await uploadPhotos(entityId, entityType, [{ uri: result.uri }])
    if (res.ok) {
      haptics.success()
      toast.success('Photo uploaded')
      loadPhotos()
    } else {
      haptics.error()
      toast.error('Upload failed')
    }
    setUploading(false)
  }

  const getUrl = (photo: Photo, thumbnail = false) => {
    if (thumbnail && photo.thumbnailUrl) return photo.thumbnailUrl
    if (photo.url) return photo.url
    const base = getApiUrl()
    return thumbnail ? `${base}/api/photos/${photo.id}/thumbnail` : `${base}/api/photos/${photo.id}/file`
  }

  return (
    <View>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.text }]}>Photos ({photos.length})</Text>
        <View style={styles.addBtns}>
          <TouchableOpacity style={[styles.addBtn, { backgroundColor: t.primaryLight }]} onPress={() => handleAdd('camera')} disabled={uploading}>
            <Ionicons name="camera" size={16} color={t.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.addBtn, { backgroundColor: t.primaryLight }]} onPress={() => handleAdd('gallery')} disabled={uploading}>
            <Ionicons name="images" size={16} color={t.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginVertical: 20 }} color={t.primary} />
      ) : photos.length === 0 && !uploading ? (
        <TouchableOpacity style={[styles.emptyBox, { borderColor: t.border }]} onPress={() => handleAdd('camera')}>
          <Ionicons name="camera-outline" size={24} color={t.textMuted} />
          <Text style={{ color: t.textMuted, fontSize: 12 }}>Tap to add first photo</Text>
        </TouchableOpacity>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {uploading && (
            <View style={[styles.thumb, styles.uploadingThumb, { borderColor: t.primary }]}>
              <ActivityIndicator color={t.primary} />
            </View>
          )}
          {photos.map(photo => (
            <TouchableOpacity key={photo.id} onPress={() => setViewPhoto(photo)}>
              <Image source={{ uri: getUrl(photo, true) }} style={styles.thumb} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Full-screen viewer */}
      <Modal visible={!!viewPhoto} transparent animationType="fade" onRequestClose={() => setViewPhoto(null)}>
        <View style={styles.modal}>
          <TouchableOpacity style={styles.modalClose} onPress={() => setViewPhoto(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {viewPhoto && (
            <Image source={{ uri: getUrl(viewPhoto) }} style={styles.fullImage} resizeMode="contain" />
          )}
          {viewPhoto?.caption && (
            <Text style={styles.caption}>{viewPhoto.caption}</Text>
          )}
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
  modalClose: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 8 },
  fullImage: { width: SCREEN_WIDTH, height: SCREEN_WIDTH },
  caption: { color: '#fff', fontSize: 14, marginTop: 12, textAlign: 'center' },
})
