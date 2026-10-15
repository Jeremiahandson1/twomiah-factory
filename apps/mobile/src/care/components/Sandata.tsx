/**
 * Caregiver-side Sandata EVV pieces (the agency web app's SandataEvv, for the phone):
 *   · SandataPromptCard — "Now check IN/OUT on Sandata" after a punch
 *   · SandataIdBox      — the client's Medicaid ID with Copy (and "Copy ID & open Sandata")
 *   · SandataHelp       — first-login help for Sandata Mobile Connect
 *   · SandataNotice     — one-time "Sandata EVV is required" notice, per caregiver per phone
 *   · VisitSandata      — on the open visit: the Open-Sandata button, the ID, or "EVV hours done"
 * Data comes from GET /api/sandata/caregiver-context (via CareContext). The agency's Sandata ID is
 * the server's; no state, agency or phone number is written into this file.
 */
import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, Modal, ScrollView, Linking, Platform, Clipboard, TouchableOpacity } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../../theme/ThemeContext'
import { useToast } from '../../components/ToastProvider'
import { useAuth } from '../../auth/AuthContext'
import { useCare } from '../CareContext'
import { evvWeekMet, medicaidIdOf, needsSandata, showSandataNotice, smcLinks, visitNeedsSandata, type SandataClient } from '../sandata'
import { Banner, BannerText, Button, useTone, usePrimaryInk } from '../ui'

export async function openSandata(): Promise<boolean> {
  for (const url of smcLinks(Platform.OS)) {
    try { await Linking.openURL(url); return true } catch { /* try the next link */ }
  }
  return false
}

export function SandataIdBox({ client, withOpen = false }: { client: SandataClient | null | undefined; withOpen?: boolean }) {
  const t = useTheme()
  const tone = useTone('info')
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  if (!needsSandata(client)) return null
  const ma = medicaidIdOf(client)
  if (!ma) return null
  const copy = async (andOpen: boolean) => {
    try { Clipboard.setString(ma); setCopied(true); setTimeout(() => setCopied(false), 4000) } catch { toast.warning(`Couldn't copy — the client ID is ${ma}`) }
    if (andOpen) await openSandata()
  }
  return (
    <View style={[styles.idBox, { backgroundColor: t.surface, borderColor: tone.border }]}>
      <Text style={[styles.idLabel, { color: t.textSecondary }]}>Client ID for Sandata (Medicaid ID)</Text>
      <View style={styles.idRow}>
        <Text selectable style={[styles.idValue, { color: t.text }]}>{ma}</Text>
        <Button small variant="secondary" label={copied ? 'Copied' : 'Copy'} icon={copied ? 'checkmark' : 'copy-outline'} onPress={() => copy(false)} />
      </View>
      {withOpen && <Button style={{ marginTop: 8 }} label="Copy ID & open Sandata" icon="open-outline" onPress={() => copy(true)} />}
      <Text style={[styles.idHint, { color: t.textSecondary }]}>In Sandata, paste this when it asks for the client.</Text>
    </View>
  )
}

export function SandataHelp() {
  const { user } = useAuth()
  const { sandata } = useCare()
  const t = useTheme()
  const agencyId = sandata?.sandataAgencyId || null
  const steps = [
    'Download the free Sandata Mobile Connect app (dark blue logo) from the App Store or Google Play. You need the app — there is no website login for caregivers.',
    'Find the welcome email from Sandata — it has your temporary password. Not in your inbox? Check spam, or search your email for "Sandata".',
    `Username: the email address that welcome email was sent to${user?.email ? ` — the email we have for you is ${user.email}` : ''}.`,
    'Password: the temporary password from that email. It works once — the app then asks you to make your own.',
    agencyId ? `Company ID: pick ${agencyId} from the list.` : 'Company ID: pick our agency from the list (ask the office for our Sandata agency ID).',
    'Do this first login on Wi-Fi, and allow location "While Using the App".',
  ]
  return (
    <View style={[styles.help, { backgroundColor: t.surfaceAlt, borderColor: t.border }]}>
      <Text style={[styles.helpTitle, { color: t.text }]}>Logging in to Sandata the first time</Text>
      {steps.map((s, i) => (
        <Text key={i} style={[styles.helpStep, { color: t.text }]}>{i + 1}. {s}</Text>
      ))}
      <Text style={[styles.helpStep, { color: t.textSecondary, marginTop: 6 }]}>
        No welcome email from Sandata at all? You haven't been added yet — tell the office. Login trouble: call your state's EVV customer care line (the office has the number).
      </Text>
    </View>
  )
}

export function SandataPromptCard() {
  const { sandataPrompt, sandataClient, dismissSandataPrompt } = useCare()
  const [showHelp, setShowHelp] = useState(false)
  if (!sandataPrompt) return null
  const client = sandataClient(sandataPrompt.clientId)
  const inOut = sandataPrompt.kind === 'in' ? 'IN' : 'OUT'
  return (
    <Banner tone="info" icon="phone-portrait-outline" title={`Now check ${inOut} on Sandata`}>
      <BannerText tone="info">
        {sandataPrompt.clientName ? `${sandataPrompt.clientName}'s` : "This client's"} visits are verified in Sandata. The visit must also be {sandataPrompt.kind === 'in' ? 'checked in' : 'checked out'} on the Sandata Mobile Connect app — do it now, while you're at the home.
      </BannerText>
      <SandataIdBox client={client} withOpen />
      {!medicaidIdOf(client) && (
        <Button style={{ marginTop: 10 }} label="Open the Sandata app" icon="open-outline" onPress={async () => { await openSandata(); dismissSandataPrompt() }} />
      )}
      <BannerText tone="info">Not installed yet? The button opens the store page so you can get it (one time).</BannerText>
      <Button style={{ marginTop: 6 }} variant="ghost" label="I already did it" onPress={dismissSandataPrompt} />
      <Button variant="ghost" small label={showHelp ? 'Hide login help' : 'How do I log in to Sandata?'} onPress={() => setShowHelp((v) => !v)} />
      {showHelp && <SandataHelp />}
    </Banner>
  )
}

/** On the open visit. */
export function VisitSandata({ clientId, sandataRequired }: { clientId: string; sandataRequired: boolean | null | undefined }) {
  const { sandataClient } = useCare()
  const [showHelp, setShowHelp] = useState(false)
  const client = sandataClient(clientId)
  if (evvWeekMet(client, sandataRequired)) {
    return <Banner tone="success" icon="checkmark-circle">This week's EVV hours for this client are done — no Sandata for this visit.</Banner>
  }
  if (!visitNeedsSandata(client, sandataRequired)) return null
  return (
    <Banner tone="info" icon="phone-portrait-outline" title="Sandata check-in / check-out">
      <BannerText tone="info">This visit also goes in Sandata Mobile Connect: check in when you arrive, check out when you leave.</BannerText>
      <Button style={{ marginTop: 10 }} variant="secondary" label="Open the Sandata app" icon="open-outline" onPress={openSandata} />
      <SandataIdBox client={client} />
      <Button variant="ghost" small label={showHelp ? 'Hide login help' : 'How do I log in to Sandata?'} onPress={() => setShowHelp((v) => !v)} />
      {showHelp && <SandataHelp />}
    </Banner>
  )
}

const NOTICE_KEY = (u: string) => `twomiah_care_sandata_notice_v1_${u}`

/** One-time notice, only while the caregiver has a client in Sandata. */
export function SandataNotice() {
  const { sandata, userId } = useCare()
  const { company } = useAuth()
  const t = useTheme()
  const link = usePrimaryInk()
  const [dismissed, setDismissed] = useState<boolean | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  useEffect(() => {
    if (!userId) return
    AsyncStorage.getItem(NOTICE_KEY(userId)).then((v) => setDismissed(!!v)).catch(() => setDismissed(false))
  }, [userId])
  const open = dismissed === false && showSandataNotice(sandata, false)
  const dismiss = (withHelp: boolean) => {
    if (userId) AsyncStorage.setItem(NOTICE_KEY(userId), new Date().toISOString()).catch(() => {})
    if (withHelp) setShowHelp(true)
    else setDismissed(true)
  }
  const phone = String((company as any)?.phone || '')
  const tel = phone.replace(/[^\d+]/g, '')
  return (
    <Modal visible={open || showHelp} transparent animationType="fade" onRequestClose={() => { setShowHelp(false); setDismissed(true) }}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: t.surface }]}>
          <ScrollView>
            {showHelp ? (
              <>
                <SandataHelp />
                <Button style={{ marginTop: 12 }} label="Done" onPress={() => { setShowHelp(false); setDismissed(true) }} />
              </>
            ) : (
              <>
                <Text style={[styles.noticeTitle, { color: t.text }]}>Important: Sandata EVV is required</Text>
                <Text style={[styles.noticeText, { color: t.text }]}>
                  Every visit for a client who is in Sandata must also be checked in and checked out on the Sandata Mobile Connect app, at the client's home, at the time of the visit.
                </Text>
                <Text style={[styles.noticeText, { color: t.text }]}>
                  Visits entered by hand afterward count as manual entries, and too many of them get an agency flagged. Keep clocking in and out in this app as usual, and also check in and out on Sandata.
                </Text>
                <Text style={[styles.noticeText, { color: t.text }]}>1. Download the free Sandata Mobile Connect app (dark blue logo).</Text>
                <Text style={[styles.noticeText, { color: t.text }]}>2. Log in with the welcome email from Sandata (username = your email, temporary password from that email{sandata?.sandataAgencyId ? `, Company ID ${sandata.sandataAgencyId}` : ''}).</Text>
                <Text style={[styles.noticeText, { color: t.text }]}>3. At each of these visits: check in when you arrive, check out when you leave. This app will remind you.</Text>
                {tel ? (
                  <TouchableOpacity onPress={() => Linking.openURL(`tel:${tel}`)} accessibilityRole="link">
                    <Text style={[styles.noticeText, { color: link, fontWeight: '700' }]}>Questions? Call the office at {phone}</Text>
                  </TouchableOpacity>
                ) : null}
                <Button style={{ marginTop: 8 }} label="I understand — show me how to set it up" onPress={() => dismiss(true)} />
                <Button style={{ marginTop: 8 }} variant="secondary" label="I understand" onPress={() => dismiss(false)} />
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  idBox: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 10 },
  idLabel: { fontSize: 13, fontWeight: '700' },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  idValue: { flex: 1, fontSize: 22, fontWeight: '800', letterSpacing: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  idHint: { fontSize: 12, marginTop: 6 },
  help: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 8 },
  helpTitle: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  helpStep: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 16 },
  sheet: { borderRadius: 16, padding: 18, maxHeight: '88%' },
  noticeTitle: { fontSize: 20, fontWeight: '800', marginBottom: 10 },
  noticeText: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
})
