import { execSync } from 'child_process'

const MAX_RETRIES = 20
const RETRY_DELAY_MS = 10000

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    console.log(`[migrate] Attempt ${attempt}/${MAX_RETRIES}...`)
    execSync('bun x drizzle-kit migrate', { stdio: 'inherit' })
    console.log('[migrate] Success')
    process.exit(0)
  } catch (err: any) {
    if (attempt === MAX_RETRIES) {
      console.error(`[migrate] Failed after ${MAX_RETRIES} attempts`)
      process.exit(1)
    }
    console.log(`[migrate] Connection failed, retrying in ${RETRY_DELAY_MS / 1000}s...`)
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
  }
}
