/**
 * Haptic feedback helper — provides consistent tactile feedback across the app.
 */

import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'

const isIOS = Platform.OS === 'ios'

export function useHaptics() {
  const light = () => {
    if (isIOS) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  const medium = () => {
    if (isIOS) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }

  const heavy = () => {
    if (isIOS) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
  }

  const success = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  const error = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
  }

  const selection = () => {
    Haptics.selectionAsync()
  }

  return { light, medium, heavy, success, error, selection }
}
