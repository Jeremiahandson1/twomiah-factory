// Open the Pay run and show it (the period is the last two weeks).
export async function before(page: any) {
  await page.getByRole('button', { name: 'Show' }).first().click()
  await page.waitForLoadState('networkidle')
  await page.getByText('Pay run').first().scrollIntoViewIfNeeded()
}
