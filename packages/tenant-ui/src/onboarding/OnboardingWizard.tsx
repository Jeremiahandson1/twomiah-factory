import React from 'react'

// Phase 0.5 stub — full implementation lands in Phase 3.
// The tenant's root router will redirect to /onboarding when
// companies.onboarding_completed_at IS NULL. This component
// drives the wizard: CompanyConfirm → EmailAliases → TeamInvites
// → ImportContacts → Done.

export interface OnboardingWizardProps {
  productId: string
  onComplete: () => void
}

export function OnboardingWizard(_props: OnboardingWizardProps): React.ReactElement | null {
  return null
}
