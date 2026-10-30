/**
 * Add an expense, with a photo of the receipt — the desktop's Expenses form (tenant-ui people/ExpensesPage.tsx), by its own calls:
 *   GET  /api/expenses/categories                 { categories: [{ value, label }] } — the business's own list
 *   POST /api/expenses { date, category, vendor, description, amount, reimbursable }   (expenses:create; dated today — the
 *                                                 server takes only a day that has happened)
 *   POST /api/expenses/:id/receipt                multipart `receipt` (expenses:update). The server reads the bytes, not the name.
 *                                                 503 storage_not_configured: the expense is kept, the photo is not — said so.
 * Then the saved expense opens.
 */
import React, { useEffect, useState } from 'react'
import { Image, View } from 'react-native'
import { useRouter } from 'expo-router'
import { get, post, upload } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/AuthContext'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useCamera } from '../../../src/hooks/useCamera'
import { Screen, TextField, Chip, ChipRow, Button, DText, Card, space, radius } from '../../../src/design'
import { paymentDollars } from '../invoice/[id]'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function NewExpense() {
  const router = useRouter()
  const toast = useToast()
  const haptics = useHaptics()
  const { can } = useAuth()
  const { takePhoto, pickImage } = useCamera()
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([])
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [vendor, setVendor] = useState('')
  const [payBack, setPayBack] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    get('/api/expenses/categories').then((r) => {
      const list = Array.isArray(r.data?.categories) ? r.data.categories : []
      setCategories(list)
      if (list[0]) setCategory((c) => c || list[0].value)
    })
  }, [])

  const save = async () => {
    const dollars = paymentDollars(amount)
    if (dollars === null) { toast.error('Enter the amount'); return }
    if (!description.trim()) { toast.error('Say what it was for'); return }
    if (!category) { toast.error('Choose a category'); return }
    setBusy(true)
    const res = await post('/api/expenses', { date: ymd(new Date()), category, vendor: vendor.trim() || null, description: description.trim(), amount: dollars, reimbursable: payBack })
    if (!res.ok) { setBusy(false); haptics.error(); toast.error(res.error || 'The expense was not saved'); return }
    const id = res.data?.id
    if (photo && id && can('expenses:update')) {
      const fd = new FormData()
      fd.append('receipt', { uri: photo, type: 'image/jpeg', name: `receipt_${Date.now()}.jpg` } as any)
      const up = await upload(`/api/expenses/${id}/receipt`, fd)
      if (!up.ok) toast.error(up.error ? `Saved, but the receipt photo was not kept: ${up.error}` : 'Saved, but the receipt photo was not kept')
    }
    setBusy(false)
    haptics.success()
    toast.success('Expense saved')
    if (id) router.replace({ pathname: '/(details)/t/[spec]/[id]', params: { spec: 'office-expenses', id } } as any)
    else router.back()
  }

  return (
    <Screen title="Add an expense" onBack={() => router.back()} footer={<Button label="Save expense" icon="checkmark" size="lg" fullWidth loading={busy} onPress={save} />}>
      <View style={{ gap: space[3] }}>
        <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" prefix="$" required />
        <TextField label="What it was for" value={description} onChangeText={setDescription} placeholder="e.g. Grout and tile spacers" required />
        <TextField label="Where (optional)" value={vendor} onChangeText={setVendor} placeholder="e.g. Menards" />
        <View style={{ gap: space[2] }}>
          <DText variant="callout" tone="textSecondary">Category</DText>
          <ChipRow>{categories.map((cat) => <Chip key={cat.value} label={cat.label} selected={category === cat.value} onPress={() => setCategory(cat.value)} />)}</ChipRow>
        </View>
        <ChipRow><Chip label="I paid for it myself — pay me back" selected={payBack} onPress={() => setPayBack((v) => !v)} /></ChipRow>
        <Card>
          <View style={{ gap: space[2] }}>
            <DText variant="bodyStrong">Receipt</DText>
            {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 220, borderRadius: radius.md }} resizeMode="contain" accessibilityLabel="The receipt photo" /> : null}
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <Button label={photo ? 'Retake' : 'Take a photo'} icon="camera" variant="tonal" onPress={async () => { const p = await takePhoto(); if (p) setPhoto(p.uri) }} />
              <Button label="From photos" icon="images" variant="tonal" onPress={async () => { const p = await pickImage(); if (p) setPhoto(p.uri) }} />
            </View>
          </View>
        </Card>
      </View>
    </Screen>
  )
}
