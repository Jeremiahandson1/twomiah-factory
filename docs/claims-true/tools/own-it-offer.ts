// The checkout as the owner sees it with "I'll host it myself" picked — its effect is on the screen before the button.
export async function before(page: any) {
  await fetch('http://localhost:4311/__set', { method: 'POST', body: JSON.stringify({ license: null }) })
  await page.reload(); await page.waitForLoadState('networkidle')
  await page.getByLabel('I’ll host it myself').check()
  await page.fill('#own-it-github', 'acme-builders')
  await page.check('input[type=checkbox]')
  await page.locator('#own-it-title').scrollIntoViewIfNeeded()
}
