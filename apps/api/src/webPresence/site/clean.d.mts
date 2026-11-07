// Types for clean.mjs (a plain .mjs so the site's own function can bundle it with no build step).
export function cleanLine(v: unknown, max: number): string
export function cleanBlock(v: unknown, max: number): string
export function cleanLink(v: unknown): string
export function cleanImage(v: unknown): string
export function cleanDate(v: unknown): string
export function cleanEmail(v: unknown): string
export function cleanPhone(v: unknown): string
export function cleanShape(shape: unknown, v: unknown, depth?: number): any
export function cleanHours(v: unknown): any
export function cleanModel(raw: unknown, spec: any, prev?: any): any
export function effectiveForms(model: any): { lead: boolean; hiring: boolean }
export const modelTooBig: (m: unknown) => boolean
export const RESUME_TYPES: Record<string, string>
export function cleanLead(f: Record<string, any>, extraLabels?: string[]): { ok: boolean; error?: string; fields: Record<string, string> }
export function cleanApplication(f: Record<string, any>, jobs?: string[]): { ok: boolean; error?: string; fields: Record<string, string> }
export function checkResume(file: { name: string; size: number; head?: Uint8Array } | null, limitMb?: number): { ok: boolean; error?: string; ext: string; none?: boolean }
export function checkImage(bytes: Uint8Array, limit?: number): { ok: boolean; error?: string; mime: string; ext: string }
export function cleanUsd(v: unknown): string
export function usdCents(v: unknown): number | null
export const DOWNLOAD_TYPES: Record<string, string>
export function checkDownload(bytes: Uint8Array, name: string, limit?: number): { ok: boolean; error?: string; ext: string; mime: string; name: string }
export function downloadOffer(model: any): { name: string; priceCents: number; license: string } | null
export const cleanLocation: (v: unknown) => string
