// After payment: the licence recorded, the GitHub invitation sent, the export emailed.
export async function before(page: any) {
  await fetch('http://localhost:4311/__set', { method: 'POST', body: JSON.stringify({ license: { paidAt: '2026-10-28T12:00:00Z', githubUsername: 'acme-builders', amountCents: 356400, handoverStatus: 'complete', repoInvited: true, exportSent: true } }) })
  await page.reload(); await page.waitForLoadState('networkidle')
  await page.locator('#own-it-title').scrollIntoViewIfNeeded()
}
