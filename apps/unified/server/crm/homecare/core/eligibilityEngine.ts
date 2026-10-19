// Caregiver eligibility analysis against background-check findings. Moved from
// templates/crm-homecare/backend/src/services/eligibilityEngine.ts (ported there from CVHC).
//
// Decision model:
//   clear          — no record found, no match against the bar list
//   flagged_review — record(s) found but nothing matches an active disqualifier, or only "advisory" matches
//   rehab_review   — the worst match is "rehab_review": hiring only after a state rehabilitation review
//   disqualified   — at least one "permanent_bar" match. No hire.
//
// Rule-based on purpose: caregiver eligibility is a legal determination. The engine surfaces the matched statutes and
// the admin makes the call. The bar list is per state (caregiver_disqualifiers.state), and only the agency's own
// state's rows are used.
//
// Changes: the agency is a company — the bar list read is the company's own rows (caregiver_disqualifiers carries
// company_id), the default state is the company's, and the caregiver's latest check is read within the company.
import { and, eq, desc } from 'drizzle-orm'
import { backgroundChecks, caregiverDisqualifiers } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyProfiles } from './agencyProfile.ts'

const SEVERITY_ORDER: Record<string, number> = { permanent_bar: 3, rehab_review: 2, advisory: 1 }

export type EligibilityMatch = {
  category: string; statute: string; short_title: string; description: string | null; severity: string; matched_text: string
}
export type EligibilityResult = {
  status: 'clear' | 'flagged_review' | 'rehab_review' | 'disqualified'
  matches: EligibilityMatch[]
  summary: string
  recommendation: string
}

export type WorcsInput = {
  hasRecord?: boolean | null
  result?: string | null
  findings?: string | null
  rawResult?: string | null
  description?: string | null
  details?: unknown
} | null | undefined

export function createEligibilityEngine(d: CrmDeps, deps: { profile: AgencyProfiles }) {
  /**
   * Evaluate one WORCS result against the company's bar list. `state` is the agency's two-letter state; undefined
   * reads the company's own (null means "no state": no bar list applies).
   */
  async function evaluateWorcsResult(companyId: string, worcs: WorcsInput, state?: string | null): Promise<EligibilityResult> {
    if (!worcs) {
      return {
        status: 'flagged_review',
        matches: [],
        summary: 'No WORCS result available to evaluate.',
        recommendation: 'Re-run the background check before hiring.',
      }
    }

    // No record → cleared.
    if (worcs.hasRecord === false || worcs.result === 'cleared') {
      return {
        status: 'clear',
        matches: [],
        summary: 'No criminal record was returned by the Wisconsin DOJ Online Record Check System.',
        recommendation: 'Approve — no criminal history per WORCS.',
      }
    }

    // Everything searchable in the payload.
    const haystack = [
      worcs.findings,
      worcs.rawResult,
      worcs.result,
      worcs.description,
      JSON.stringify(worcs.details || {}),
    ].filter(Boolean).join('\n').toLowerCase()

    const agencyState = state === undefined ? (await deps.profile.getAgencyProfile(companyId)).state : state
    const disqualifiers: any[] = agencyState
      ? await d.db.select().from(caregiverDisqualifiers)
          .where(and(
            eq(caregiverDisqualifiers.companyId, companyId),
            eq(caregiverDisqualifiers.isActive, true),
            eq(caregiverDisqualifiers.state, agencyState),
          ))
      : []

    const matches: EligibilityMatch[] = []
    for (const dq of disqualifiers) {
      const patterns = Array.isArray(dq.matchPatterns) ? (dq.matchPatterns as unknown[]) : []
      for (const pattern of patterns) {
        try {
          const m = haystack.match(new RegExp(String(pattern), 'i'))
          if (m) {
            matches.push({
              category: dq.category, statute: dq.statute, short_title: dq.shortTitle,
              description: dq.description, severity: dq.severity, matched_text: m[0],
            })
            break // one pattern hit is enough for this disqualifier
          }
        } catch (err: any) {
          d.logger.warn(`[eligibility] bad regex on disqualifier ${dq.statute}`, { error: err?.message })
        }
      }
    }

    // One entry per statute.
    const seen = new Set<string>()
    const unique = matches.filter((m) => (seen.has(m.statute) ? false : (seen.add(m.statute), true)))
    const maxSeverity = unique.reduce((max, m) => Math.max(max, SEVERITY_ORDER[m.severity] || 0), 0)

    if (unique.length === 0) {
      return {
        status: 'flagged_review',
        matches: [],
        summary: 'WORCS returned a record but no entries match the Wisconsin statutory caregiver bar list. Manual review required.',
        recommendation: 'Review the raw WORCS report for any disqualifying content not captured by automated rules. If nothing disqualifying, proceed with hiring.',
      }
    }

    if (maxSeverity === SEVERITY_ORDER.permanent_bar) {
      const perm = unique.filter((m) => m.severity === 'permanent_bar')
      return {
        status: 'disqualified',
        matches: unique,
        summary: `WORCS record matches ${perm.length} permanent caregiver bar${perm.length === 1 ? '' : 's'} under Wisconsin law. This candidate cannot be hired as a caregiver.`,
        recommendation: `Do not hire. Matched: ${perm.map((m) => m.statute).join(', ')}.`,
      }
    }

    if (maxSeverity === SEVERITY_ORDER.rehab_review) {
      return {
        status: 'rehab_review',
        matches: unique,
        summary: 'WORCS record matches one or more offenses that bar caregiver employment unless the applicant obtains a Wisconsin DHS rehabilitation review finding substantial evidence of rehabilitation.',
        recommendation: 'Do not hire until applicant obtains a DHS rehabilitation review. Give the applicant a copy of the report and the FCRA summary of rights per § 1681b(b)(3).',
      }
    }

    return {
      status: 'flagged_review',
      matches: unique,
      summary: 'WORCS record contains advisory-level matches. These do not automatically bar employment, but warrant admin consideration.',
      recommendation: "Review matches below; hiring is permitted at the agency's discretion.",
    }
  }

  /** The most recent WORCS check for a caregiver of the company, evaluated. Does NOT persist a decision. */
  async function runEligibilityForCaregiver(companyId: string, caregiverId: string): Promise<EligibilityResult> {
    const [bc] = await d.db.select().from(backgroundChecks)
      .where(and(
        eq(backgroundChecks.companyId, companyId),
        eq(backgroundChecks.caregiverId, caregiverId),
        eq(backgroundChecks.checkType, 'worcs'),
      ))
      .orderBy(desc(backgroundChecks.createdAt))
      .limit(1)
    if (!bc) {
      return {
        status: 'flagged_review',
        matches: [],
        summary: 'No WORCS background check has been run yet.',
        recommendation: 'Send onboarding packet to the caregiver to collect consent and run WORCS.',
      }
    }
    return evaluateWorcsResult(companyId, {
      hasRecord: bc.result === 'record_found' ? true : (bc.result === 'clear' ? false : null),
      result: bc.result,
      findings: bc.findings,
      rawResult: bc.notes,
    })
  }

  return { evaluateWorcsResult, runEligibilityForCaregiver }
}

export type EligibilityEngine = ReturnType<typeof createEligibilityEngine>
