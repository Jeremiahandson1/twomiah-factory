import React from 'react'
import ReactDOM from 'react-dom/client'
import { applyStoredTheme, setTrialBypassPaths } from './shared'
import App from './App'
import { LOCK_WAYS_OUT } from './lockPaths'
import './index.css'

// The saved theme and colour on <html> before the first render: the sign-in pages render outside the shell, which is
// what applies them otherwise.
applyStoredTheme()

// A locked company's ways out are this app's (./lockPaths.ts).
setTrialBypassPaths(LOCK_WAYS_OUT)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
