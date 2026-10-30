import { useState } from 'react'
import * as ImagePicker from 'expo-image-picker'
import { Alert } from 'react-native'
import { stampFromExif, type PhotoStamp } from '../photos/stamp'

export interface PhotoResult {
  uri: string
  width: number
  height: number
  base64?: string
  /** Where and when the camera says it took the photo (from its EXIF; empty when it said nothing). */
  stamp?: PhotoStamp
}

export function useCamera() {
  const [loading, setLoading] = useState(false)

  const takePhoto = async (): Promise<PhotoResult | null> => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera access is needed to take job site photos.')
      return null
    }

    setLoading(true)
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        base64: false,
        exif: true,
      })
      if (result.canceled || !result.assets[0]) return null
      const asset = result.assets[0]
      return { uri: asset.uri, width: asset.width, height: asset.height, stamp: stampFromExif(asset.exif as any) }
    } finally {
      setLoading(false)
    }
  }

  const pickImage = async (): Promise<PhotoResult | null> => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Photo library access is needed.')
      return null
    }

    setLoading(true)
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        base64: false,
      })
      if (result.canceled || !result.assets[0]) return null
      const asset = result.assets[0]
      return { uri: asset.uri, width: asset.width, height: asset.height }
    } finally {
      setLoading(false)
    }
  }

  return { takePhoto, pickImage, loading }
}
