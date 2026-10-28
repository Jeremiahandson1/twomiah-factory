/**
 * This phone's push token, remembered so signing out can take it off the server. The server keeps a token against the person
 * who registered it (POST /api/push/expo-token); until it is removed (DELETE, the caller's own) a signed-out phone keeps
 * getting that person's alerts — a visit, a client's name — on a screen the next person may hold. Kept apart from
 * usePushNotifications.ts (expo-notifications) so a test runs it under plain bun.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '../api/client'

const KEY = 'twomiah_push_token_v1'

export const rememberPushToken = (token: string) => AsyncStorage.setItem(KEY, token).catch(() => {})

/** Tell the server this phone is signed out, then forget the token. Never throws: sign-out must always finish. */
export async function forgetPushToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(KEY)
    if (!token) return
    // Without the 401-refresh retry loop mattering: if the session is already gone the server has nothing to remove for us.
    await api('/api/push/expo-token', { method: 'DELETE', body: JSON.stringify({ token }) }).catch(() => {})
    await AsyncStorage.removeItem(KEY)
  } catch {
    /* no signal: the token stays on the server until this phone's next sign-in replaces it */
  }
}
