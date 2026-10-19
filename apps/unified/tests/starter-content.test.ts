// Every vertical's day-one help is its own (VerticalSettings.starter; written at provisioning by modules/provision.ts).
// The unified app had given every vertical the contractor CRM's articles — a salon, a vet, a bar or a home-care agency
// found "Creating and Sending Quotes" in Help — and those articles named things the app does not have. Each vertical's
// set was rewritten against its screens, every claim checked in the code (2026-10-19).
import { describe, test, expect } from 'bun:test'
import { loadVertical } from '../server/core/vertical.ts'
import { BASE_STARTER } from '../server/core/starter.ts'

const OWN = ['basic', 'fieldservice', 'landscaping', 'restaurant', 'rv', 'salon', 'vet', 'bar', 'homecare']

/** Claims the articles once made that the app does not do (each found false in the code). */
const NOT_IN_THE_APP = [
  /\btags?\b/i,                               // contacts carry no tags
  /click (on )?a date/i,                      // the Schedule is a week view; a date is not clickable
  /day, week,? and month views/i,
  /reminders? for overdue/i,                  // no overdue-invoice reminders outside home care
  /attach (files|documents)/i,                // the Documents upload names no record
  /Reveal SSN|Submit WORCS Check|Deactivate/, // home care's
  /\{\{|\}\}/,                                // a template placeholder
]

describe('day-one help', () => {
  for (const id of OWN) {
    test(`${id} has its own articles, not the contractor CRM's`, async () => {
      const v = await loadVertical(id)
      expect(v.starter).toBeDefined()
      const titles = v.starter!.helpArticles.map((a) => a.title)
      expect(titles.length).toBeGreaterThan(4)
      expect(new Set(titles).size).toBe(titles.length)
      if (id !== 'basic') expect(v.starter!.helpArticles).not.toEqual(BASE_STARTER.helpArticles)
    })
  }

  test('no article claims what the app does not do', async () => {
    const wrong: string[] = []
    for (const s of [BASE_STARTER, ...(await Promise.all(OWN.map(loadVertical))).map((v) => v.starter!)]) {
      for (const a of s.helpArticles) for (const re of NOT_IN_THE_APP) if (re.test(a.content)) wrong.push(`${a.title}: ${re}`)
    }
    expect(wrong).toEqual([])
  })

  test("the salon's article → feature links name articles it has (an unmatched title is never hidden)", async () => {
    const salon = await loadVertical('salon')
    const titles = new Set(salon.starter!.helpArticles.map((a) => a.title))
    const linked = Object.keys(salon.crm?.help?.articleFeatures ?? {})
    expect(linked.length).toBeGreaterThan(0)
    expect(linked.filter((t) => !titles.has(t))).toEqual([])
  })

  test('a vertical with no price book is given no price-book categories', async () => {
    for (const id of ['restaurant', 'rv', 'salon', 'vet', 'bar', 'homecare']) {
      const v = await loadVertical(id)
      expect({ id, cats: v.starter!.pricebookCategories.default }).toEqual({ id, cats: [] })
    }
  })
})
