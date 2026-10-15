import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import { post } from '../api/client'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

/**
 * registerWithServer: post the Expo push token to POST /api/push/subscribe. Off for home care — that
 * backend's /api/push/subscribe stores ONE web-push subscription per user and its sender is web-push
 * only, so an Expo token would overwrite the caregiver's browser subscription and still never be
 * delivered. Taps on notifications are still routed; registration waits for an Expo-aware endpoint.
 */
export function usePushNotifications(opts: { registerWithServer?: boolean; fallbackRoute?: string } = {}) {
  const registerWithServer = opts.registerWithServer !== false
  const fallbackRoute = opts.fallbackRoute || '/(tabs)/notifications'
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null)
  const [notification, setNotification] = useState<Notifications.Notification | null>(null)
  const notificationListener = useRef<any>()
  const responseListener = useRef<any>()

  useEffect(() => {
    registerForPush(registerWithServer).then(setExpoPushToken).catch(() => {})

    notificationListener.current = Notifications.addNotificationReceivedListener(n => {
      setNotification(n)
    })

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, any>
      const type = data?.type as string
      const id = data?.id as string

      // Twomiah Care (home care) pushes open a list, not a record, and carry no id.
      const LIST_ROUTES: Record<string, string> = {
        open_shift: '/(care)/open-shifts',
        shift_swap_request: '/(care)/swaps',
        shift_warning: '/(tabs)/time-clock',
        message: '/(tabs)/messages',
        visit_rescheduled: '/(tabs)/care-schedule',
        reschedule_denied: '/(care)/requests',
        change_request_counter: '/(care)/requests',
      }
      if (type && LIST_ROUTES[type]) {
        router.push(LIST_ROUTES[type] as any)
        return
      }

      if (!type || !id) {
        router.push(fallbackRoute as any)
        return
      }

      const ROUTE_MAP: Record<string, string> = {
        job: '/(details)/job/',
        job_updated: '/(details)/job/',
        job_created: '/(details)/job/',
        job_status_changed: '/(details)/job/',
        contact: '/(details)/contact/',
        contact_created: '/(details)/contact/',
        contact_updated: '/(details)/contact/',
        quote: '/(details)/quote/',
        quote_sent: '/(details)/quote/',
        quote_approved: '/(details)/quote/',
        quote_updated: '/(details)/quote/',
        invoice: '/(details)/invoice/',
        invoice_sent: '/(details)/invoice/',
        invoice_paid: '/(details)/invoice/',
        invoice_updated: '/(details)/invoice/',
        payment: '/(details)/invoice/',
        order: '/(details)/order/',
        lead: '/(details)/lead/',
      }

      const route = ROUTE_MAP[type]
      if (route) {
        const targetId = type === 'payment' ? (data.invoiceId || id) : id
        router.push(`${route}${targetId}` as any)
      } else {
        router.push(fallbackRoute as any)
      }
    })

    return () => {
      if (notificationListener.current) Notifications.removeNotificationSubscription(notificationListener.current)
      if (responseListener.current) Notifications.removeNotificationSubscription(responseListener.current)
    }
  }, [])

  return { expoPushToken, notification }
}

async function registerForPush(registerWithServer: boolean): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('[Push] Must use physical device for push notifications')
    return null
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    })
  }

  const { status: existing } = await Notifications.getPermissionsAsync()
  let finalStatus = existing
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  if (finalStatus !== 'granted') return null

  const projectId = Constants.expoConfig?.extra?.eas?.projectId
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data

  if (!registerWithServer) return token

  // Register token with CRM backend
  await post('/api/push/subscribe', {
    token,
    platform: Platform.OS,
    deviceName: Device.deviceName,
  })

  return token
}
