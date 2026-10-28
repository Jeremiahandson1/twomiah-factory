/**
 * A desktop page inside the app, already signed in and laid out for the phone.
 *
 * The app never puts its sign-in into an address or a page: it asks the business's own server for a one-time CODE (POST
 * /api/auth/web-handoff — 60 seconds, once, bound to this person and business) and opens /api/auth/web-handoff/<code> here; the server
 * turns it into the ordinary cookie web session and sends the browser to the page. This browser opens ONLY the business's own address
 * (src/more/webTarget.ts); a link to anywhere else opens the phone's browser. Signing out of the app ends the web session.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Linking, UIManager, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { getApiUrl, getRefreshToken, post } from '../../src/api/client'
import { isOwnAddress, pageAddress } from '../../src/more/webTarget'
import { Screen, EmptyState, SkeletonRows, Button } from '../../src/design'

// The in-app browser is a native module. A phone running an older build of the app does not have it yet: say so and use the
// phone's browser instead of crashing.
let WebViewComponent: any = null
try { WebViewComponent = require('react-native-webview').WebView } catch { WebViewComponent = null }
const hasNativeWebView = () => !!WebViewComponent && (UIManager as any).getViewManagerConfig?.('RNCWebView') != null

export default function WebPage() {
  const router = useRouter()
  const { path, title } = useLocalSearchParams<{ path?: string; title?: string }>()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const asked = useRef(false)
  const own = getApiUrl()
  const native = hasNativeWebView()

  const start = async () => {
    setError(null); setLoading(true)
    const page = pageAddress(own, String(path || ''))
    if (!page) { setError('This page cannot be opened here.'); setLoading(false); return }
    const r = await post<{ url: string }>('/api/auth/web-handoff', { path: String(path), refreshToken: getRefreshToken() })
    if (!r.ok || !r.data?.url) { setError(r.error || 'Could not open the page. Check your connection and try again.'); setLoading(false); return }
    const full = own.replace(/\/+$/, '') + r.data.url
    if (!isOwnAddress(full, own)) { setError('This page cannot be opened here.'); setLoading(false); return }
    if (!native) { await Linking.openURL(full); setLoading(false); return }
    setUrl(full); setLoading(false)
  }
  useEffect(() => { if (!asked.current) { asked.current = true; start() } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen title={String(title || 'Full page')} onBack={() => router.back()} scroll={false}>
      {error ? <EmptyState icon="alert-circle" title="Could not open this page" body={error} action="Try again" onAction={start} />
        : loading ? <SkeletonRows count={4} />
        : !native ? (
          <View style={{ padding: 16, gap: 12 }}>
            <EmptyState icon="open" title="Opened in your browser" body="This version of the app opens full pages in your phone's browser. Update the app to see them inside it." />
            <Button label="Back to the menu" variant="secondary" onPress={() => router.back()} />
          </View>
        ) : url ? (
          <WebViewComponent
            source={{ uri: url }}
            originWhitelist={[own.replace(/\/+$/, '')]}
            javaScriptEnabled domStorageEnabled
            setSupportMultipleWindows={false}
            allowsBackForwardNavigationGestures
            onShouldStartLoadWithRequest={(req: { url: string }) => {
              if (req.url === 'about:blank' || isOwnAddress(req.url, own)) return true
              Linking.openURL(req.url).catch(() => {})
              return false
            }}
            onError={() => setError('The page did not load. Check your connection and try again.')}
            accessibilityLabel={String(title || 'Full page')}
            style={{ flex: 1 }}
          />
        ) : null}
    </Screen>
  )
}
