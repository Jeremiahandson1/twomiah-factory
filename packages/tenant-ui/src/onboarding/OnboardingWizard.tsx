import React, { useState, useEffect } from 'react'
import { CompanyConfirmStep } from './steps/CompanyConfirmStep.tsx'
import { EmailAliasesStep } from './steps/EmailAliasesStep.tsx'
import { TeamInvitesStep } from './steps/TeamInvitesStep.tsx'
import { ImportContactsStep } from './steps/ImportContactsStep.tsx'
import { DoneStep } from './steps/DoneStep.tsx'

// Modular step components so the v2 AI-agent onboarding can wrap them without
// rewriting. Each step owns its own fetches; the shell is just navigation +
// progress indication.

export interface OnboardingWizardProps {
  productId: string           // e.g. 'crm', 'crm-roof' — drives vertical defaults
  onComplete: () => void
}

const STEPS = [
  { key: 'company', label: 'Company' },
  { key: 'aliases', label: 'Email Addresses' },
  { key: 'team',    label: 'Team' },
  { key: 'import',  label: 'Contacts' },
  { key: 'done',    label: 'Done' },
]

export function OnboardingWizard({ productId, onComplete }: OnboardingWizardProps): React.ReactElement {
  const [stepIdx, setStepIdx] = useState(0)

  const next = () => setStepIdx(i => Math.min(i + 1, STEPS.length - 1))
  const back = () => setStepIdx(i => Math.max(i - 1, 0))

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-3xl mx-auto px-4">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold mb-2">Welcome to Twomiah</h1>
          <p className="text-sm text-gray-600">A few quick steps to set up your CRM. Most can be revisited in Settings.</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <div className={'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ' + (i < stepIdx ? 'bg-green-500 text-white' : i === stepIdx ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-500')}>
                {i < stepIdx ? '✓' : i + 1}
              </div>
              {i < STEPS.length - 1 && <div className={'w-8 h-0.5 ' + (i < stepIdx ? 'bg-green-500' : 'bg-gray-200')} />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          {stepIdx === 0 && <CompanyConfirmStep onNext={next} />}
          {stepIdx === 1 && <EmailAliasesStep productId={productId} onBack={back} onNext={next} />}
          {stepIdx === 2 && <TeamInvitesStep onBack={back} onNext={next} />}
          {stepIdx === 3 && <ImportContactsStep onBack={back} onNext={next} />}
          {stepIdx === 4 && <DoneStep onComplete={onComplete} />}
        </div>
      </div>
    </div>
  )
}
