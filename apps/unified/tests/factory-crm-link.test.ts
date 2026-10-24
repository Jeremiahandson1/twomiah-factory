// The Factory's customer page links a unified business's CRM to its sign-in, not to the bare Render address, which is
// the website (Higgs, 10/24: all three links opened the website). On the business's own domain, the CRM is app.<domain>.
import { describe, test, expect } from 'bun:test'
import { crmSignInUrl } from '../../platform/src/components/factory/crmSignIn.ts'

describe('the CRM link on the Factory customer page', () => {
  test('a business on its Render address: the CRM is /crm there, not "/" (the website)', () => {
    expect(crmSignInUrl('https://twomiah-live-test-builders-app.onrender.com', 'https://twomiah-live-test-builders-app.onrender.com')).toBe('https://twomiah-live-test-builders-app.onrender.com/crm')
    expect(crmSignInUrl('https://x-app.onrender.com', null)).toBe('https://x-app.onrender.com/crm')
  })
  test('a business whose website runs on its own domain: the CRM is app.<domain>/crm', () => {
    expect(crmSignInUrl('https://higgs-heritage-builders-app.onrender.com', 'https://higgsheritagebuilders.com')).toBe('https://app.higgsheritagebuilders.com/crm')
    expect(crmSignInUrl('https://higgs-heritage-builders-app.onrender.com', 'higgsheritagebuilders.com')).toBe('https://app.higgsheritagebuilders.com/crm')
    expect(crmSignInUrl('https://h-app.onrender.com', 'https://www.HiggsHeritageBuilders.com/')).toBe('https://app.higgsheritagebuilders.com/crm')
  })
  test('a website address that is not a real domain falls back to Render', () => {
    expect(crmSignInUrl('https://h-app.onrender.com', 'not a url %%')).toBe('https://h-app.onrender.com/crm')
  })
})
