/**
 * Sandata help — setting up Sandata Mobile Connect, and the Medicaid IDs of the caregiver's clients
 * who are in Sandata (GET /api/sandata/caregiver-context, via CareContext).
 */
import React from 'react'
import { Text } from 'react-native'
import { useTheme } from '../../src/theme/ThemeContext'
import { useCare } from '../../src/care/CareContext'
import { needsSandata } from '../../src/care/sandata'
import { CareScreen } from '../../src/care/screen'
import { Button, Card, SectionTitle } from '../../src/care/ui'
import { SandataHelp, SandataIdBox, openSandata } from '../../src/care/components/Sandata'

export default function SandataHelpScreen() {
  const t = useTheme()
  const care = useCare()
  const inSandata = (care.sandata?.clients || []).filter(needsSandata)
  return (
    <CareScreen>
      <Text style={{ color: t.text, fontSize: 15, lineHeight: 22, marginBottom: 8 }}>
        Visits for the clients below must also be checked in and out on the Sandata Mobile Connect app, at the client's home. This app reminds you after each clock-in and clock-out.
      </Text>
      <Button label="Open the Sandata app" icon="open-outline" onPress={openSandata} />
      <SandataHelp />
      <SectionTitle>Your clients in Sandata</SectionTitle>
      {inSandata.length === 0 && <Text style={{ color: t.textSecondary, fontSize: 14 }}>None right now.</Text>}
      {inSandata.map((c) => (
        <Card key={c.id}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>{`${c.first_name || ''} ${c.last_name || ''}`.trim()}</Text>
          <SandataIdBox client={c} />
        </Card>
      ))}
    </CareScreen>
  )
}
