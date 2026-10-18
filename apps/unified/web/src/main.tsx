import React from 'react'
import ReactDOM from 'react-dom/client'
import { applyStoredTheme } from './shared'
import App from './App'
import './index.css'

// The saved theme and colour on <html> before the first render: the sign-in pages render outside the shell, which is
// what applies them otherwise.
applyStoredTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
