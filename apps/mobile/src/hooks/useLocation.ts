import { useState, useCallback } from 'react'
import * as Location from 'expo-location'
import { Alert } from 'react-native'

export interface LocationResult {
  latitude: number
  longitude: number
  accuracy: number | null
  timestamp: number
}

export function useLocation() {
  const [loading, setLoading] = useState(false)
  const [location, setLocation] = useState<LocationResult | null>(null)

  const requestLocation = useCallback(async (): Promise<LocationResult | null> => {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Location access is needed for field check-ins.')
      return null
    }

    setLoading(true)
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      })
      const result: LocationResult = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy,
        timestamp: loc.timestamp,
      }
      setLocation(result)
      return result
    } catch (err: any) {
      Alert.alert('Location Error', err.message || 'Could not get current location')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return { location, requestLocation, loading }
}
