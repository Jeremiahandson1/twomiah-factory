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

export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null)
  const [notification, setNotification] = useState<Notifications.Notification | null>(null)
  const notificationListener = useRef<any>()
  const responseListener = useRef<any>()

  useEffect(() => {
    registerForPush().then(setExpoPushToken)

    notificationListener.current = Notifications.addNotificationReceivedListener(n => {
      setNotification(n)
    })

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, any>
      const type = data?.type as string
      const id = data?.id as string

      if (!type || !id) {
        router.push('/(tabs)/notifications')
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
        router.push('/(tabs)/notifications')
      }
    })

    return () => {
      if (notificationListener.current) Notifications.removeNotificationSubscription(notificationListener.current)
      if (responseListener.current) Notifications.removeNotificationSubscription(responseListener.current)
    }
  }, [])

  return { expoPushToken, notification }
}

async function registerForPush(): Promise<string | null> {
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

  // Register token with CRM backend
  await post('/api/push/subscribe', {
    token,
    platform: Platform.OS,
    deviceName: Device.deviceName,
  })

  return token
}
