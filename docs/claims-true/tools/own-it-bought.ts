// After payment, having chosen to host it themselves: the licence, the invitation, the export, and the end date.
export async function before(page: any) {
  await fetch('http://localhost:4311/__set', { method: 'POST', body: JSON.stringify({ license: { paidAt: '2026-10-28T12:00:00Z', githubUsername: 'acme-builders', amountCents: 356400, hosting: 'self', hostingEndAt: '2026-11-20T00:00:00Z', handoverStatus: 'complete', repoInvited: true, exportSent: true } }) })
  await page.reload(); await page.waitForLoadState('networkidle')
  await page.locator('#own-it-title').scrollIntoViewIfNeeded()
}
