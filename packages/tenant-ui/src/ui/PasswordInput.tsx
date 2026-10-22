// A password box with an eye: the person typing can show what they typed, and hide it again (owner, 2026-10-22: "i want
// an eye on passwords so people can see them"). It shows only what is in the box — a saved password is stored hashed
// and can never be shown to anyone.
//
// Every prop is the input's own (id, value, onChange, autoComplete, className…); the box starts hidden, and the eye is
// a real button (aria-label, aria-pressed) that never submits the form.
import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export function PasswordInput({ className = '', ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input {...props} type={shown ? 'text' : 'password'} className={`${className} pr-10`} style={{ ...(props.style || {}), paddingRight: '2.5rem' }} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        title={shown ? 'Hide password' : 'Show password'}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        {shown ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
      </button>
    </div>
  )
}
