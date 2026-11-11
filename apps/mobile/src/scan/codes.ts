/**
 * Barcode scanning (parity tier 2 #10, feature barcode_scanning, not ready) — the decisions, with no React Native in them, so
 * tests/mobile/barcode-scan.test.ts runs them under plain bun. ./BarcodeScanner.tsx does the camera work.
 */
import type { BarcodeType } from 'expo-camera'

/** The codes on parts, boxes and products: retail (UPC / EAN), the warehouse's (Code 128 / 39, ITF-14) and QR labels. */
export const BARCODE_TYPES: BarcodeType[] = ['upc_a', 'upc_e', 'ean13', 'ean8', 'code128', 'code39', 'code93', 'itf14', 'codabar', 'qr', 'datamatrix']

/** What a scan read, as the search box should get it: printable, no spaces or line breaks round it, at most 64 characters; '' for nothing usable. */
export function cleanCode(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return s.length > 64 ? '' : s
}
