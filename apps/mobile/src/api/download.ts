// Opening a file the server only gives to a signed-in person, in the phone's browser (kept out of client.ts, which the
// sign-in tests load under plain bun, without React Native).
import { Linking } from 'react-native'
import { getApiUrl, post } from './client'

/**
 * A quote's or an invoice's PDF in the phone's browser, which has no session: ask a one-time 60-second link (POST
 * /api/downloads — apps/unified/server/http/downloads.ts; the server fetches the file as this person when the link is
 * opened) and open that. Returns the server's error, if any.
 */
export async function openDownload(path: string): Promise<string | null> {
  const r = await post<{ url: string }>('/api/downloads', { path })
  if (!r.ok || !r.data?.url) return r.error || 'Could not get the file'
  await Linking.openURL(getApiUrl() + r.data.url)
  return null
}
