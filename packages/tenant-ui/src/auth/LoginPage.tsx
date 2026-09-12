// Sign-in page — one implementation for every CRM. The template passes its company name.
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { NavLink as RouterLink } from '../invoicing/ui'

export function LoginPage({ companyName }: { companyName: string }) {
  const navigate = useNavigate()
  const { login, error } = useAuth()
  const [formData, setFormData] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setLocalError('')
    try {
      await login(formData.email.toLowerCase().trim(), formData.password)
      navigate('/')
    } catch (err) {
      setLocalError((err as Error).message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-800'

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center py-12 px-4 dark:bg-slate-800">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">{companyName}</h1>
          <p className="mt-2 text-gray-600 dark:text-slate-400">Sign in to your account</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8 dark:bg-slate-900">
          {(localError || error) && (
            <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm dark:bg-red-950/40 dark:border-red-900 dark:text-red-300">
              {localError || error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Email</label>
              <input
                id="login-email"
                type="email"
                name="email"
                autoComplete="username"
                required
                autoCapitalize="none"
                autoCorrect="off"
                value={formData.email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, email: e.target.value })}
                className={inputCls}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Password</label>
              <input
                id="login-password"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={formData.password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, password: e.target.value })}
                className={inputCls}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm">
            <RouterLink to="/forgot-password" className="text-gray-500 hover:text-gray-700 font-medium dark:text-slate-400 dark:hover:text-slate-200">
              Forgot password?
            </RouterLink>
          </div>
        </div>
      </div>
    </div>
  )
}
