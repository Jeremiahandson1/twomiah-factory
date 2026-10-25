// The Reviews page's sentences (ReviewsPage.tsx), apart from the page so a test can read them for every business.
import { vocabulary, capital } from '../labels/vocabulary'
import type { ReviewsConfig } from '../settings/integrationsTypes'

/**
 * The page's sentences, from the business's vocabulary (labels/vocabulary.ts): who it asks, where the Send review
 * request button is (every customer's page; a job's too where the business has the jobs screens), and whether anything
 * asks by itself (vocabulary.reviewAfter — what the server does). Where nothing does, the page offers asking by hand
 * only: a bar's page promised requests "when jobs are completed" (bar live test, 2026-10-25). A template's own config
 * still wins, sentence by sentence.
 */
export function reviewsCopy(config?: ReviewsConfig): Required<Omit<ReviewsConfig, 'hasFeature'>> & { auto: boolean; customer: string; reviewAfter: string } {
  const w = vocabulary()
  const auto = !!w.reviewAfter
  const onWorkPage = !!w.work && (config?.hasFeature ? config.hasFeature('jobs') : true)
  const manualHelp = onWorkPage && w.work ? `on a ${w.work.one}'s page or a ${w.customer.one}'s page` : `on a ${w.customer.one}'s page`
  const { hasFeature: _hasFeature, ...own } = config || {}
  return {
    auto,
    subtitle: auto ? `Ask ${w.customer.many} for a Google review — automatically after ${w.reviewAfter}, or one at a time` : `Ask ${w.customer.many} for a Google review, one at a time`,
    subjectLabel: w.work ? capital(w.work.one) : '',
    autoRequestHelp: auto ? `Ask automatically after ${w.reviewAfter}` : '',
    emptyHelp: auto ? `Once Auto-Request Reviews is on, a request is made after ${w.reviewAfter}. Or use Send review request ${manualHelp}.` : `Use Send review request ${manualHelp} to ask one person.`,
    manualHelp,
    customer: w.customer.one,
    reviewAfter: w.reviewAfter || '',
    ...own,
  }
}
