/**
 * The app's start address ("/", twomiah:///). No screen lived here since (tabs)/index.tsx was removed, so a fresh
 * launch showed Expo's "Unmatched Route" page — the root layout's redirect runs after that first render and is not
 * enough on its own. This sends the person to sign-in, or to their first tab by name (useHomeHref).
 * The root layout shows a spinner until the saved sign-in is read, so isLoading is already settled here.
 */
import { Redirect } from 'expo-router'
import { useAuth } from '../src/auth/AuthContext'
import { useHomeHref } from '../src/vertical/useHomeHref'

export default function Index() {
  const { isAuthenticated } = useAuth()
  const home = useHomeHref()
  return <Redirect href={isAuthenticated ? home : '/(auth)/login'} />
}
