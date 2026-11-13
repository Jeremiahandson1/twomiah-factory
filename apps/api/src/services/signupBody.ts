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

/**
 * What an uploaded picture IS, by its bytes (the type a browser states is only a claim): one of the five the public forms take,
 * or null. An SVG is a drawing, never a page: one with a script, an event handler, embedded HTML or a script address is null.
 */
export function imageTypeOf(buf: Uint8Array): string | null {
  const b = buf
  if (b.length < 12) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  const text = Buffer.from(b).toString('utf8')
  const head = text.slice(0, 2000).replace(/^﻿/, '').trimStart()
  if (!/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return null
  if (/<script|<foreignObject|<iframe|<object|<embed|\son[a-z]+\s*=|javascript:|<!ENTITY/i.test(text)) return null
  return 'image/svg+xml'
}

/** Characters that are code syntax where the templates generator pastes a value as typed (an owner's first password). */
export const NOT_PASTED_AS_TYPED = /['"`\\<>{}$\r\n]/
