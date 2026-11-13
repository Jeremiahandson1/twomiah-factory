// What the PUBLIC signup may ask for (security review S5-7, 2026-11-13). Kept apart from the route so it is tested as it is.
//
// The signup is open to anyone, and its body used to be written to the business's record as sent: any feature list (a paid
// Add-on Product included, at the price of the cheapest plan), any product ('vision', 'website-premium'), an "email" that was
// any text with an @ in it (the templates generator pastes the email into source code), a colour that was any text, a slug
// that was any text. Each answer is checked to its own shape by the route, once, before anything reads it.
import { crmTemplateFor, startingFeaturesFor } from '../config/industryRouting'
import { getFeaturesForPlan, isPaidAddOn } from '../config/featureRegistry'

export const SIGNUP_EMAIL_RE = /^[^\s@<>"`\\,;:(){}\[\]$]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/
export const SIGNUP_HEX_RE = /^#[0-9a-fA-F]{6}$/
export const SIGNUP_PLAN_RE = /^[A-Za-z0-9_-]{1,40}$/

/** An email address a signup may give, trimmed; null when it is not one. */
export function signupEmail(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s && s.length <= 200 && SIGNUP_EMAIL_RE.test(s) ? s : null
}

/** The products a signup may name: the CRM and the website. Paid products (the Visualizer, a premium site) are never the form's to add. */
export function signupProductList(v: unknown): string[] {
  const out = (Array.isArray(v) ? v : []).filter((p): p is string => typeof p === 'string' && (p === 'crm' || p === 'website' || p === 'cms' || /^crm-[a-z]{2,20}$/.test(p)))
  return [...new Set(out)].slice(0, 6)
}

/** The features a signup may pick: only ones its industry's plan includes — never a paid Add-on Product or a not-ready feature. */
export function signupFeatureList(v: unknown, industry: string | undefined | null): string[] {
  if (!Array.isArray(v) || !v.length) return []
  const allowed = new Set([...getFeaturesForPlan(crmTemplateFor(industry)), ...startingFeaturesFor(industry, { unified: true })])
  return [...new Set(v.filter((f): f is string => typeof f === 'string' && allowed.has(f) && !isPaidAddOn(f)))]
}

/** The account's name in addresses (repo, services, database): letters, digits and dashes only, whoever typed it. */
export function signupSlug(v: unknown): string {
  return typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60).replace(/-$/, '') : ''
}

/** Characters that are code syntax where the templates generator pastes a value as typed (an owner's first password). */
export const NOT_PASTED_AS_TYPED = /['"`\\<>{}$\r\n]/
