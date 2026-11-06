/**
 * A landscaping visit's photos, before and after the work (landscaping parity row 9; Yardbook before/after, LMN task photos, Jobber's
 * camera on the visit). The job's own photo strip (src/components/PhotoGallery.tsx) with a Before / After choice:
 *   · taken from the camera or chosen from the phone's photos;
 *   · with no signal each photo stays a FILE on the phone and goes through the offline queue (src/offline/localPhotos.ts), shown as
 *     waiting until it is sent — POST /api/jobs/:id/photos/file, then /photos/saved with its kind;
 *   · drawn on — arrows, circles, words — where the business has photo_markup (the marked copy goes to the customer instead).
 * Before- and after-photos both go with the visit-done message (apps/unified server/data/visitReports.ts visitPhotos).
 */
import React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useAuth } from '../../src/auth/AuthContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { PhotoGallery } from '../../src/components/PhotoGallery'
import { Screen, Card, DText, EmptyState, space } from '../../src/design'

export default function VisitPhotos() {
  const router = useRouter()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const { jobId } = useLocalSearchParams<{ jobId: string }>()
  if (!jobId || !hasFeature('photo_capture') || !can('jobs:read')) {
    return <Screen title="Visit photos" onBack={() => router.back()}><EmptyState icon="lock-closed" title="Not available" body="Your business has not turned on job photos for your seat." /></Screen>
  }
  return (
    <Screen title="Visit photos" onBack={() => router.back()}>
      <View style={{ gap: space[3] }}>
        <DText variant="callout" tone="textSecondary">Take a photo before you start and another when you finish. With no signal they wait on your phone and send themselves later.</DText>
        <Card><PhotoGallery jobId={jobId} canAdd={can('jobs:update')} kinds /></Card>
      </View>
    </Screen>
  )
}
