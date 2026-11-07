export const SIGNIN_TTL_SEC: number
export const SESSION_TTL_SEC: number
export function hmac(secret: string, data: string): Promise<string>
export function safeEqual(a: string, b: string): boolean
export function randomId(bytes?: number): string
export function siteSecret(master: string, siteId: string): Promise<string>
export function mintSignin(secret: string, siteId: string, now?: number, ttlSec?: number): Promise<string>
export function verifySignin(secret: string, token: string, siteId: string, now?: number): Promise<{ ok: boolean; error?: string; jti: string; exp: number }>
export function mintSession(secret: string, siteId: string, now?: number, ttlSec?: number): Promise<string>
export function verifySession(secret: string, token: string, siteId: string, now?: number): Promise<{ ok: boolean; error?: string; sid: string; exp: number }>
export function signRequest(secret: string, ts: string, body: string): Promise<string>
export function verifyRequest(secret: string, ts: string, body: string, sig: string, now?: number, skewSec?: number): Promise<boolean>
export function rateLimit(store: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> }, key: string, limit: number, windowSec: number, now?: number): Promise<{ allowed: boolean; remaining: number }>
export function hashAddr(secret: string, addr: string): Promise<string>
export const DOWNLOAD_TTL_SEC: number
export function mintDownload(secret: string, siteId: string, saleId: string, now?: number, ttlSec?: number): Promise<string>
export function verifyDownload(secret: string, token: string, siteId: string, now?: number): Promise<{ ok: boolean; error?: string; saleId: string; exp: number }>
export const PASSWORD_ROUNDS: number
export const PASSWORD_MIN: number
export const PASSWORD_MAX: number
export function hashPassword(password: string, rounds?: number): Promise<{ v: number; salt: string; rounds: number; hash: string }>
export function checkPassword(password: string, rec: any): Promise<boolean>
