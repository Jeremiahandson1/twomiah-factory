// Reset-password page (from the emailed link) — one implementation for every CRM. The template passes its api client.
import React, { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Lock, CheckCircle, XCircle } from 'lucide-react'
import type { AuthApi } from './types'
import { PASSWORD_RULE_TEXT, passwordMeetsRule } from './types'
import { NavLink as RouterLink } from '../invoicing/ui'

const inputCls = 'w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 border-gray-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100'

export function ResetPasswordPage({ api }: { api: Pick<AuthApi, 'resetPassword'> }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (!token) setError('Invalid or missing reset token') }, [token])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    if (!passwordMeetsRule(password)) { setError(`Password must be ${PASSWORD_RULE_TEXT}`); return }
    if (password !== confirmPassword) { setError('Passwords do not match'); return }
    setLoading(true)
    try {
      await api.resetPassword(token!, password)
      setSuccess(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      setError((err as Error).message || 'Failed to reset password')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 dark:bg-slate-900">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 dark:bg-green-900/40">
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2 dark:text-slate-100">Password reset successful</h1>
          <p className="text-gray-600 mb-6 dark:text-slate-400">Your password has been changed. Redirecting to login...</p>
          <RouterLink to="/login" className="inline-block px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">Go to login</RouterLink>
        </div>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 dark:bg-slate-900">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 dark:bg-red-900/40">
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2 dark:text-slate-100">Invalid link</h1>
          <p className="text-gray-600 mb-6 dark:text-slate-400">This password reset link is invalid or has expired.</p>
          <RouterLink to="/forgot-password" className="inline-block px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">Request new link</RouterLink>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 dark:bg-slate-900">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-xl shadow-lg p-8 dark:bg-slate-900 dark:border dark:border-slate-800">
          <h1 className="text-2xl font-bold text-gray-900 mb-2 dark:text-slate-100">Set new password</h1>
          <p className="text-gray-600 mb-6 dark:text-slate-400">Your new password must be {PASSWORD_RULE_TEXT}.</p>

          {error && (
            <div role="alert" className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm dark:bg-red-950/40 dark:text-red-300">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="reset-password" className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">New Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="reset-password"
                  type="password"
                  name="new-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                  className={inputCls}
                  placeholder="Enter new password"
                  required
                  minLength={8}
                />
              </div>
            </div>

            <div>
              <label htmlFor="reset-confirm" className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Confirm Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="reset-confirm"
                  type="password"
                  name="confirm-password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
                  className={inputCls}
                  placeholder="Confirm new password"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Resetting...' : 'Reset password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
