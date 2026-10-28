/**
 * Lead — one enquiry: who, what they asked for, where it stands, and what to do next.
 * Statuses are the server's (new, contacted, converted, dismissed): PUT /api/leads/:id/status sets new / contacted / dismissed,
 * and "Convert to customer" is POST /api/leads/:id/convert (it links an existing customer with the same email or phone). A note is
 * POST /api/leads/:id/notes. "Create quote" converts first (a quote belongs to a customer) and opens the quote form for them.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get, post, put } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/AuthContext'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { Screen, Card, Group, ListRow, SectionHeader, DText, Badge, Button, TextField, ChipRow, Chip, EmptyState, SkeletonRows, space, layout } from '../../../src/design'
import { callPhone, textPhone, emailTo } from '../../../src/home/links'
import { LEAD_STATUS_LABEL } from './index'

const SETTABLE = ['new', 'contacted', 'dismissed']
const TONE: Record<string, any> = { new: 'info', contacted: 'warning', converted: 'success', dismissed: 'neutral' }

export default function LeadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const haptics = useHaptics()
  const { can } = useAuth()
  const [lead, setLead] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const canWork = can('leads:update')
  const canConvert = can('leads:update') && can('contacts:create')
  const canQuote = canConvert && can('quotes:create')

  const load = useCallback(async () => {
    const res = await get(`/api/leads/${id}`)
    if (res.ok) setLead(res.data)
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  const setStatus = async (status: string) => {
    setBusy(true)
    const res = await put(`/api/leads/${id}/status`, { status })
    setBusy(false)
    if (res.ok) { haptics.success(); setLead((l: any) => ({ ...l, status })) } else { haptics.error(); toast.error(res.error || 'Could not change the status') }
  }
  const convert = async (): Promise<string | null> => {
    setBusy(true)
    const res = await post(`/api/leads/${id}/convert`)
    setBusy(false)
    // 409 = already converted: the answer still names the customer.
    const contactId = res.ok ? res.data?.contact?.id : (res as any).data?.contactId
    if (res.ok) { haptics.success(); toast.success('Converted to a customer'); await load() }
    else if (!contactId) { haptics.error(); toast.error(res.error || 'Could not convert this lead') }
    return contactId || null
  }
  const addNote = async () => {
    if (!note.trim()) return
    setBusy(true)
    const res = await post(`/api/leads/${id}/notes`, { text: note.trim() })
    setBusy(false)
    if (res.ok) { haptics.success(); setNote(''); toast.success('Note added'); load() } else { haptics.error(); toast.error(res.error || 'Could not add the note') }
  }
  const createQuote = async () => {
    const contactId = lead.convertedContactId || (await convert())
    if (contactId) router.push({ pathname: '/(details)/quote/form', params: { contactId } } as any)
  }

  if (loading) return <Screen title="Lead" onBack={() => router.back()}><SkeletonRows count={4} /></Screen>
  if (!lead) return <Screen title="Lead" onBack={() => router.back()}><EmptyState icon="person" title="Lead not found" /></Screen>
  const converted = lead.status === 'converted'

  return (
    <Screen title={lead.homeownerName || 'Lead'} subtitle={[lead.jobType, lead.location].filter(Boolean).join(' · ') || undefined} onBack={() => router.back()}>
      <View style={{ gap: layout.sectionGap }}>
        <Card>
          <View style={{ gap: space[3] }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <DText variant="callout" tone="textSecondary">{lead.sourcePlatform ? `From ${lead.sourcePlatform}` : 'Enquiry'}</DText>
              <Badge label={LEAD_STATUS_LABEL[lead.status] || lead.status} tone={TONE[lead.status] || 'neutral'} />
            </View>
            {lead.budget ? <DText variant="body">Budget: {lead.budget}</DText> : null}
            {lead.description ? <DText variant="body">{lead.description}</DText> : <DText variant="callout" tone="textSecondary">No details were left with this enquiry.</DText>}
          </View>
        </Card>

        {(lead.phone || lead.email) ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {lead.phone ? <Button label="Call" icon="call" variant="tonal" onPress={() => callPhone(lead.phone)} accessibilityHint={`Calls ${lead.homeownerName}`} /> : null}
            {lead.phone ? <Button label="Text" icon="chatbubble" variant="tonal" onPress={() => textPhone(lead.phone)} accessibilityHint={`Texts ${lead.homeownerName}`} /> : null}
            {lead.email ? <Button label="Email" icon="mail" variant="tonal" onPress={() => emailTo(lead.email)} accessibilityHint={`Emails ${lead.homeownerName}`} /> : null}
          </View>
        ) : null}

        {canWork && !converted ? (
          <View style={{ gap: space[2] }}>
            <SectionHeader title="Where it stands" />
            <ChipRow>{SETTABLE.map((s) => <Chip key={s} label={LEAD_STATUS_LABEL[s]} selected={lead.status === s} onPress={() => lead.status !== s && !busy && setStatus(s)} />)}</ChipRow>
          </View>
        ) : null}

        {canWork ? (
          <View style={{ gap: space[2] }}>
            <SectionHeader title="Add a note" />
            <TextField label="Note" value={note} onChangeText={setNote} multiline placeholder="What was said, what to do next" />
            <Button label="Add note" variant="secondary" loading={busy} disabled={!note.trim()} onPress={addNote} />
          </View>
        ) : null}

        {converted && lead.convertedContactId ? (
          <Group><ListRow icon="person" title="View customer" subtitle="This lead is now a customer" divider={false} onPress={() => router.push(`/(details)/contact/${lead.convertedContactId}` as any)} /></Group>
        ) : null}

        <View style={{ gap: space[2] }}>
          {canQuote ? <Button label="Create quote" icon="document-text" size="lg" fullWidth loading={busy} onPress={createQuote} /> : null}
          {canConvert && !converted ? <Button label="Convert to customer" icon="person-add" variant="secondary" size="lg" fullWidth loading={busy} onPress={convert} /> : null}
        </View>
      </View>
    </Screen>
  )
}
