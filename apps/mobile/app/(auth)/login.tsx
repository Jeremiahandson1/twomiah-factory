import React, { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import Constants from 'expo-constants'
import { useAuth } from '../../src/auth/AuthContext'
import type { MfaChallenge } from '../../src/auth/signIn'
import { getApiUrl } from '../../src/api/client'

const APP_NAME: string = (Constants.expoConfig?.extra as any)?.appName || 'Twomiah'
const VARIANT: string = (Constants.expoConfig?.extra as any)?.appVariant || ''
const PRIMARY: string = (Constants.expoConfig?.extra as any)?.primaryColor || '#1e40af'
const VARIANT_ICON: 'home' | 'construct' | 'heart' =
  VARIANT === 'roofer' ? 'home' : VARIANT === 'care' ? 'heart' : 'construct'
const TAGLINE =
  VARIANT === 'roofer'
    ? 'Sign in to your roofing CRM'
    : VARIANT === 'care'
    ? 'Caregivers: sign in to your home care agency'
    : VARIANT === 'build'
    ? 'Sign in to your contractor CRM'
    : 'Sign in to your CRM'

/** Strip protocol, www., trailing slashes/paths/whitespace. */
function normalizeServerUrl(input: string): string {
  let url = input.trim().toLowerCase()
  url = url.replace(/^https?:\/\//, '')
  url = url.replace(/^www\./, '')
  url = url.replace(/\/.*$/, '')
  return 'https://' + url
}

export default function LoginScreen() {
  const { login, completeMfa } = useAuth()
  const [serverUrl, setServerUrl] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  /**
   * The code step. Sign-in answers a session OR `mfaRequired` with a challenge — the same sign-in,
   * waiting for a code — so the challenge replaces the form and the password is not asked for twice.
   * Six digits get the number pad; a recovery code (letters) gets the full keyboard.
   */
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null)
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)

  // Pre-fill server URL from last successful login (stored in SecureStore).
  useEffect(() => {
    const last = getApiUrl()
    if (last) setServerUrl(last.replace(/^https?:\/\//, ''))
  }, [])

  const handleLogin = async () => {
    setError('')
    if (!serverUrl.trim()) { setError('Server URL is required'); return }
    if (!email.trim()) { setError('Email is required'); return }
    if (!password) { setError('Password is required'); return }

    const url = normalizeServerUrl(serverUrl)

    setLoading(true)
    const result = await login(url, email.trim(), password)
    setLoading(false)

    if (result.mfa) {
      setChallenge(result.mfa)
      setCode('')
      setUseRecovery(false)
      return
    }
    if (!result.ok) {
      setError(result.error || 'Login failed')
    }
  }

  /** Back to the password — on "Start again", and when the challenge can no longer be completed. */
  const backToPassword = (message = '') => {
    setChallenge(null)
    setCode('')
    setUseRecovery(false)
    setPassword('')
    setError(message)
  }

  const handleCode = async () => {
    if (!challenge) return
    setError('')
    if (!code.trim()) { setError('Enter the code from your authenticator app'); return }
    setLoading(true)
    const result = await completeMfa(challenge.challengeId, code)
    setLoading(false)
    if (result.ok) return
    if (result.restart) { backToPassword(result.error || 'That sign-in request has expired. Sign in again.'); return }
    // A wrong code (or no signal): stay here, clear the field for the next try.
    setError(result.error || 'That code was not accepted')
    setCode('')
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Logo / Brand */}
          <View style={styles.brand}>
            <View style={[styles.logoCircle, { backgroundColor: PRIMARY }]}>
              <Ionicons name={VARIANT_ICON} size={32} color="#fff" />
            </View>
            <Text style={styles.brandName}>{APP_NAME}</Text>
            <Text style={styles.brandSub}>{TAGLINE}</Text>
          </View>

          {challenge ? (
          <View style={styles.form}>
            <Text style={styles.stepTitle}>One more step</Text>
            <Text style={styles.stepText}>
              {useRecovery
                ? 'Enter one of your recovery codes. Each one works once.'
                : `Enter the six-digit code from your authenticator app${challenge.recoveryCodesAvailable ? ', or one of your recovery codes' : ''}.`}
            </Text>

            <Text style={styles.label}>{useRecovery ? 'Recovery code' : 'Code'}</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="key-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
              <TextInput
                key={useRecovery ? 'recovery' : 'totp'}
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder={useRecovery ? 'XXXXX-XXXXX' : '123456'}
                placeholderTextColor="#64748b"
                autoFocus
                autoCapitalize={useRecovery ? 'characters' : 'none'}
                autoCorrect={false}
                spellCheck={false}
                // The authenticator's six digits: the number pad, and the OS's code autofill.
                keyboardType={useRecovery ? 'default' : 'number-pad'}
                autoComplete={useRecovery ? 'off' : 'one-time-code'}
                textContentType={useRecovery ? 'none' : 'oneTimeCode'}
                maxLength={useRecovery ? 32 : 8}
                returnKeyType="done"
                onSubmitEditing={handleCode}
              />
            </View>

            {challenge.recoveryCodesAvailable ? (
              <TouchableOpacity onPress={() => { setUseRecovery(!useRecovery); setCode(''); setError('') }} style={styles.linkBtn}>
                <Text style={styles.linkText}>
                  {useRecovery ? 'Use the code from my authenticator app' : 'Lost your phone? Use a recovery code'}
                </Text>
              </TouchableOpacity>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity style={[styles.button, { backgroundColor: PRIMARY }]} onPress={handleCode} disabled={loading || !code.trim()} activeOpacity={0.8}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Finish signing in</Text>
              )}
            </TouchableOpacity>

            {/* A way back, because a wrong account is the other reason somebody is stuck here. */}
            <TouchableOpacity onPress={() => backToPassword()} style={styles.linkBtn} disabled={loading}>
              <Text style={[styles.linkText, styles.centerText]}>Start again</Text>
            </TouchableOpacity>
          </View>
          ) : (
          <View style={styles.form}>
            <Text style={styles.label}>Server URL</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="globe-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder="your-company.onrender.com"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </View>

            <Text style={styles.label}>Email</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="mail-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@company.com"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
              />
            </View>

            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor="#64748b"
                secureTextEntry={!showPassword}
                textContentType="password"
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity style={[styles.button, { backgroundColor: PRIMARY }]} onPress={handleLogin} disabled={loading} activeOpacity={0.8}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </TouchableOpacity>
          </View>
          )}

          <Text style={styles.footer}>
            {VARIANT === 'care'
              ? "The Server URL is your agency's Twomiah address (e.g. acme.onrender.com). Ask your office for it, along with your email and password."
              : "The Server URL is the address of your CRM website (e.g. acme.onrender.com). Your administrator can provide it if you don't have it."}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f1117' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  brand: { alignItems: 'center', marginBottom: 36 },
  logoCircle: {
    width: 64, height: 64, borderRadius: 16, backgroundColor: '#1e40af',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  brandName: { fontSize: 28, fontWeight: '700', color: '#f1f5f9' },
  brandSub: { fontSize: 15, color: '#94a3b8', marginTop: 4 },
  form: { gap: 4 },
  label: { fontSize: 13, fontWeight: '600', color: '#94a3b8', marginTop: 12, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1d2e', borderRadius: 10, borderWidth: 1, borderColor: '#334155',
  },
  inputIcon: { paddingLeft: 12 },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: 10, color: '#f1f5f9', fontSize: 15 },
  eyeBtn: { padding: 12 },
  error: { color: '#ef4444', fontSize: 13, marginTop: 8 },
  stepTitle: { fontSize: 18, fontWeight: '700', color: '#f1f5f9' },
  stepText: { fontSize: 14, color: '#94a3b8', marginTop: 4, lineHeight: 20 },
  codeInput: { fontSize: 20, letterSpacing: 4, fontVariant: ['tabular-nums'] },
  linkBtn: { paddingVertical: 10 },
  linkText: { color: '#93c5fd', fontSize: 14 },
  centerText: { textAlign: 'center', color: '#94a3b8' },
  button: {
    backgroundColor: '#1e40af', borderRadius: 10, paddingVertical: 16,
    alignItems: 'center', marginTop: 20,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footer: { textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 24, lineHeight: 17 },
})
