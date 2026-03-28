// Server-side PDF Generator using Puppeteer
// Replaces browser-based print-to-PDF with server-rendered, pixel-perfect PDFs.

import logger from './logger.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PdfOptions {
  format?: 'letter' | 'a4'
  landscape?: boolean
  margin?: { top: string; bottom: string; left: string; right: string }
  headerTemplate?: string
  footerTemplate?: string
  printBackground?: boolean
}

const DEFAULT_OPTIONS: PdfOptions = {
  format: 'letter',
  landscape: false,
  margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
  printBackground: true,
}

// ---------------------------------------------------------------------------
// Browser pool (singleton)
// ---------------------------------------------------------------------------

let browserInstance: any = null
let browserLaunchPromise: Promise<any> | null = null

async function getBrowser(): Promise<any> {
  if (browserInstance?.isConnected?.()) return browserInstance

  // Prevent multiple simultaneous launches
  if (browserLaunchPromise) return browserLaunchPromise

  browserLaunchPromise = (async () => {
    try {
      // Try puppeteer-core with custom path first, then full puppeteer
      let puppeteer: any
      try {
        puppeteer = await import('puppeteer')
      } catch {
        puppeteer = await import('puppeteer-core')
      }

      const launchOptions: any = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--font-render-hinting=none',
        ],
      }

      // Allow custom Chromium path (for production deployments)
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
      }

      browserInstance = await puppeteer.default.launch(launchOptions)

      // Handle browser crash/disconnect
      browserInstance.on('disconnected', () => {
        browserInstance = null
        browserLaunchPromise = null
      })

      logger.info('Puppeteer browser launched for PDF generation')
      return browserInstance
    } catch (err: any) {
      browserLaunchPromise = null
      throw err
    }
  })()

  return browserLaunchPromise
}

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------

/**
 * Generate a PDF buffer from an HTML string.
 * Uses a singleton Puppeteer browser instance for performance.
 */
export async function generatePdfFromHtml(
  html: string,
  options: PdfOptions = {},
): Promise<Buffer> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const browser = await getBrowser()
  const page = await browser.newPage()

  try {
    // Set content and wait for all resources (images, fonts) to load
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 30_000,
    })

    // Wait a bit for any CSS animations/transitions to settle
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: opts.format === 'a4' ? 'A4' : 'Letter',
      landscape: opts.landscape,
      margin: opts.margin,
      printBackground: opts.printBackground ?? true,
      preferCSSPageSize: true,
      displayHeaderFooter: !!(opts.headerTemplate || opts.footerTemplate),
      headerTemplate: opts.headerTemplate || '<span></span>',
      footerTemplate: opts.footerTemplate || '<span></span>',
    })

    return Buffer.from(pdfBuffer)
  } catch (err: any) {
    logger.error('PDF generation failed', { error: err.message })
    throw new Error(`PDF generation failed: ${err.message}`)
  } finally {
    await page.close().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Close the browser instance. Call on process shutdown.
 */
export async function closePdfBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {})
    browserInstance = null
    browserLaunchPromise = null
  }
}

// Graceful shutdown
process.on('beforeExit', closePdfBrowser)
