// The offer as the owner first sees it: the checkbox ticked and a GitHub name typed, so the button is live.
export async function before(page: any) {
  await fetch('http://localhost:4311/__set', { method: 'POST', body: JSON.stringify({ license: null }) })
  await page.reload(); await page.waitForLoadState('networkidle')
  await page.fill('#own-it-github', 'acme-builders')
  await page.check('input[type=checkbox]')
  await page.locator('#own-it-title').scrollIntoViewIfNeeded()
}
