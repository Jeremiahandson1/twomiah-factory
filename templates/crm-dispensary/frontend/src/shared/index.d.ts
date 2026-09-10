// Type stub for the shared UI vendored at generation time. The Twomiah Factory copies
// packages/tenant-ui/src into frontend/src/shared/ when a tenant is generated (index.ts),
// which shadows this .d.ts. In the template repo alone the folder is otherwise empty, so
// without this stub tsc cannot resolve './shared'.
import type { ComponentType } from 'react'
export const OnboardingWizard: ComponentType<any>
export const EmailAliasesStep: ComponentType<any>
export const EmailAliasesPage: ComponentType<any>
export const EmailDomainPage: ComponentType<any>
export const AccountOffboardPage: ComponentType<any>
export const InboundMessagesPage: ComponentType<any>
export const GbpReviewsPage: ComponentType<any>
export const EMAIL_ALIAS_DEFAULTS: Record<string, any>
export function getAliasDefaultsForProduct(product: string): any
